import os
import time
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import paramiko
from dotenv import load_dotenv
import json
from pydantic import BaseModel
import threading
from contextlib import asynccontextmanager
from backend import database

load_dotenv()

app = FastAPI()

SSH_HOST = os.getenv("SSH_HOST")
SSH_PORT = int(os.getenv("SSH_PORT", "22"))
SSH_USER = os.getenv("SSH_USER")
SSH_PASSWORD = os.getenv("SSH_PASSWORD")
SSH_KEY_PATH = os.getenv("SSH_KEY_PATH")
DOCKER_CONTAINER = os.getenv("DOCKER_CONTAINER", "amnezia-awg")
UPDATE_INTERVAL_SECONDS = int(os.getenv("UPDATE_INTERVAL_SECONDS", "10"))

MOCK_DATA = os.getenv("MOCK_DATA", "false").lower() == "true"
UPDATE_INTERVAL_MINUTES = int(os.getenv("UPDATE_INTERVAL_MINUTES", "1"))

def run_ssh_command(cmd: str):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        connect_kwargs = {
            "hostname": SSH_HOST,
            "port": SSH_PORT,
            "username": SSH_USER,
            "look_for_keys": False,
            "allow_agent": False
        }
        if SSH_PASSWORD:
            connect_kwargs["password"] = SSH_PASSWORD
        elif SSH_KEY_PATH and os.path.exists(os.path.expanduser(SSH_KEY_PATH)):
            connect_kwargs["key_filename"] = os.path.expanduser(SSH_KEY_PATH)
            
        client.connect(**connect_kwargs)
            
        stdin, stdout, stderr = client.exec_command(cmd)
        exit_status = stdout.channel.recv_exit_status()
        
        if exit_status != 0:
            error = stderr.read().decode('utf-8')
            raise Exception(f"Command failed with status {exit_status}: {error}")
            
        return stdout.read().decode('utf-8')
    finally:
        client.close()

def parse_awg_dump(output_text: str):
    text_parts = output_text.split('---CLIENTS---')
    dump_text = text_parts[0]
    clients_json_text = text_parts[1].strip() if len(text_parts) > 1 else "[]"
    
    amnezia_names = {}
    try:
        clients_data = json.loads(clients_json_text)
        for c in clients_data:
            pub_key = c.get("clientId")
            name = c.get("userData", {}).get("clientName")
            if pub_key and name:
                amnezia_names[pub_key] = name
    except Exception:
        pass

    names_file = os.path.join(os.path.dirname(__file__), 'names.json')
    names_map = {}
    if os.path.exists(names_file):
        try:
            with open(names_file, 'r', encoding='utf-8') as f:
                names_map = json.load(f)
        except Exception:
            pass
            
    # Merge names and groups (local overrides amnezia)
    for pub_key, name in amnezia_names.items():
        if pub_key not in names_map:
            names_map[pub_key] = {"name": name, "group": ""}
        else:
            local_conf = names_map[pub_key]
            if isinstance(local_conf, dict) and not local_conf.get("name"):
                local_conf["name"] = name

    lines = dump_text.strip().split('\n')
    interface_info = {}
    peers = []
    
    for line in lines:
        parts = line.split('\t')
        if len(parts) == 5 or len(parts) >= 10:
            interface_info = {
                "name": parts[0],
                "public_key": parts[2] if len(parts) > 2 else "",
                "listen_port": parts[3] if len(parts) > 3 else ""
            }
        elif len(parts) == 9:
            last_handshake = int(parts[5]) if parts[5].isdigit() else 0
            is_online = (time.time() - last_handshake < 180) if last_handshake > 0 else False
            
            local_conf = names_map.get(parts[1], {})
            if isinstance(local_conf, str):
                local_conf = {"name": local_conf, "group": ""}
                
            peers.append({
                "interface": parts[0],
                "public_key": parts[1],
                "name": local_conf.get("name", ""),
                "group": local_conf.get("group", ""),
                "preshared_key": parts[2],
                "endpoint": parts[3],
                "allowed_ips": parts[4],
                "latest_handshake": last_handshake,
                "transfer_rx": int(parts[6]),
                "transfer_tx": int(parts[7]),
                "persistent_keepalive": parts[8],
                "is_online": is_online
            })
    return interface_info, peers

# Global state for cached data
GLOBAL_DATA = {
    "interface": {},
    "stats": {"total_users": 0, "active_users": 0, "total_rx": 0, "total_tx": 0},
    "peers": [],
    "current_mbps": 0.0,
    "avg_24h_mbps": 0.0
}

LAST_SERVER_TIME = None
LAST_SERVER_RX = 0
LAST_SERVER_TX = 0
LAST_PEER_STATS = {} # pub_key -> {"rx": int, "tx": int}

def fetch_and_parse_data():
    global LAST_SERVER_TIME, LAST_SERVER_RX, LAST_SERVER_TX, LAST_PEER_STATS, GLOBAL_DATA
    
    if MOCK_DATA:
        with open(os.path.join(os.path.dirname(__file__), 'mock_dump.txt'), 'r', encoding='utf-8') as f:
            output = f.read()
    else:
        cmd1 = f"sudo docker exec -i {DOCKER_CONTAINER} awg show all dump"
        output1 = run_ssh_command(cmd1)
        
        cmd2 = f"sudo docker exec -i {DOCKER_CONTAINER} cat /opt/amnezia/awg/clientsTable"
        try:
            output2 = run_ssh_command(cmd2)
        except Exception as e:
            print(f"Failed to fetch clientsTable: {e}")
            output2 = "[]"
            
        output = output1 + "\n---CLIENTS---\n" + output2
        
    interface_info, peers = parse_awg_dump(output)
    
    total_rx = sum(p["transfer_rx"] for p in peers)
    total_tx = sum(p["transfer_tx"] for p in peers)
    
    now = time.time()
    current_mbps = 0.0
    
    if LAST_SERVER_TIME is not None:
        time_diff = now - LAST_SERVER_TIME
        if time_diff > 0:
            rx_diff = max(0, total_rx - LAST_SERVER_RX)
            tx_diff = max(0, total_tx - LAST_SERVER_TX)
            total_bytes = rx_diff + tx_diff
            current_mbps = (total_bytes * 8) / (time_diff * 1000000)
            
            peers_deltas = []
            for p in peers:
                pk = p["public_key"]
                last_p = LAST_PEER_STATS.get(pk, {"rx": p["transfer_rx"], "tx": p["transfer_tx"]})
                drx = max(0, p["transfer_rx"] - last_p["rx"])
                dtx = max(0, p["transfer_tx"] - last_p["tx"])
                peers_deltas.append((pk, drx, dtx))
                
            database.save_stats(current_mbps, total_rx, total_tx, peers_deltas)
            
    # Update state for next tick
    LAST_SERVER_TIME = now
    LAST_SERVER_RX = total_rx
    LAST_SERVER_TX = total_tx
    for p in peers:
        LAST_PEER_STATS[p["public_key"]] = {"rx": p["transfer_rx"], "tx": p["transfer_tx"]}
        
    GLOBAL_DATA["interface"] = interface_info
    GLOBAL_DATA["stats"] = {
        "total_users": len(peers),
        "active_users": sum(1 for p in peers if p["is_online"]),
        "total_rx": total_rx,
        "total_tx": total_tx
    }
    GLOBAL_DATA["peers"] = peers
    GLOBAL_DATA["current_mbps"] = round(current_mbps, 2)
    GLOBAL_DATA["avg_24h_mbps"] = database.get_24h_average_mbps()

def background_poller():
    while True:
        try:
            fetch_and_parse_data()
        except Exception as e:
            print(f"Background poll error: {e}")
        time.sleep(UPDATE_INTERVAL_SECONDS)

@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    try:
        fetch_and_parse_data()
    except Exception as e:
        print(f"Initial fetch error: {e}")
    
    thread = threading.Thread(target=background_poller, daemon=True)
    thread.start()
    yield

app = FastAPI(title="Amnezia Traffic Viewer", lifespan=lifespan)

@app.get("/api/stats")
def get_stats():
    return GLOBAL_DATA

def get_mock_stats():
    now = int(time.time())
    return {
        "interface": {"name": "awg0", "public_key": "mock_pub_key=", "listen_port": "51820"},
        "stats": {
            "total_users": 4,
            "active_users": 2,
            "total_rx": 1500000000,
            "total_tx": 2500000000
        },
        "peers": [
            {
                "public_key": "user1_pub_key=",
                "allowed_ips": "10.8.0.2/32",
                "endpoint": "192.168.1.100:54321",
                "latest_handshake": now - 30,
                "transfer_rx": 1000000000,
                "transfer_tx": 1500000000,
                "is_online": True
            },
            {
                "public_key": "user2_pub_key=",
                "allowed_ips": "10.8.0.3/32",
                "endpoint": "192.168.1.101:54322",
                "latest_handshake": now - 150,
                "transfer_rx": 500000000,
                "transfer_tx": 1000000000,
                "is_online": True
            },
            {
                "public_key": "user3_pub_key=",
                "allowed_ips": "10.8.0.4/32",
                "endpoint": "(none)",
                "latest_handshake": now - 86400,
                "transfer_rx": 0,
                "transfer_tx": 0,
                "is_online": False
            },
            {
                "public_key": "user4_pub_key=",
                "allowed_ips": "10.8.0.5/32",
                "endpoint": "192.168.1.102:4444",
                "latest_handshake": now - 3600,
                "transfer_rx": 5000,
                "transfer_tx": 2000,
                "is_online": False
            }
        ]
    }

@app.get("/api/stats")
def get_stats():
    if MOCK_DATA:
        return get_mock_stats()

    if not SSH_HOST or not SSH_USER:
        raise HTTPException(status_code=500, detail="SSH credentials not configured in .env")
        
    try:
        cmd = f"sudo docker exec -i {DOCKER_CONTAINER} sh -c 'awg show all dump && echo \"---CLIENTS---\" && cat /opt/amnezia/awg/clientsTable 2>/dev/null || echo \"[]\"'"
        output = run_ssh_command(cmd)
        return parse_awg_dump(output)
    except Exception as e:
        import traceback
        print(f"ERROR in get_stats: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

class UpdatePeerRequest(BaseModel):
    public_key: str
    name: str = None
    group: str = None

@app.post("/api/update_peer")
def update_peer(req: UpdatePeerRequest):
    names_file = os.path.join(os.path.dirname(__file__), 'names.json')
    names_map = {}
    if os.path.exists(names_file):
        try:
            with open(names_file, 'r', encoding='utf-8') as f:
                names_map = json.load(f)
        except Exception:
            pass
            
    # Upgrade old string format to dict
    for k, v in names_map.items():
        if isinstance(v, str):
            names_map[k] = {"name": v, "group": ""}
            
    if req.public_key not in names_map:
        names_map[req.public_key] = {"name": "", "group": ""}
        
    if req.name != None:
        names_map[req.public_key]["name"] = req.name
    if req.group != None:
        names_map[req.public_key]["group"] = req.group
    
    with open(names_file, 'w', encoding='utf-8') as f:
        json.dump(names_map, f, ensure_ascii=False, indent=2)
        
    return {"status": "ok"}

@app.get("/api/config")
def get_config():
    return {
        "update_interval_seconds": UPDATE_INTERVAL_SECONDS
    }

frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
os.makedirs(frontend_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_frontend():
    return FileResponse(os.path.join(frontend_dir, 'index.html'))

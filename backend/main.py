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

MOCK_DATA = os.getenv("MOCK_DATA", "false").lower() == "true"
UPDATE_INTERVAL_SECONDS = int(os.getenv("UPDATE_INTERVAL_SECONDS", "10"))

def load_servers():
    servers_file = os.path.join(os.path.dirname(__file__), 'servers.json')
    if os.path.exists(servers_file):
        with open(servers_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    # Fallback to .env
    return [{
        "id": "default",
        "name": "Default Server",
        "ssh_host": os.getenv("SSH_HOST"),
        "ssh_port": int(os.getenv("SSH_PORT", "22")),
        "ssh_user": os.getenv("SSH_USER"),
        "ssh_password": os.getenv("SSH_PASSWORD"),
        "ssh_key_path": os.getenv("SSH_KEY_PATH"),
        "docker_container": os.getenv("DOCKER_CONTAINER", "amnezia-awg")
    }]

SERVERS = load_servers()

def run_ssh_command(server: dict, cmd: str):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        connect_kwargs = {
            "hostname": server.get("ssh_host"),
            "port": server.get("ssh_port", 22),
            "username": server.get("ssh_user"),
            "look_for_keys": False,
            "allow_agent": False
        }
        
        password = server.get("ssh_password")
        key_path = server.get("ssh_key_path")
        
        if password:
            connect_kwargs["password"] = password
        elif key_path and os.path.exists(os.path.expanduser(key_path)):
            connect_kwargs["key_filename"] = os.path.expanduser(key_path)
            
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
    "servers": {} # server_id -> data
}

LAST_SERVER_TIME = {}
LAST_SERVER_RX = {}
LAST_SERVER_TX = {}
LAST_PEER_STATS = {} # server_id -> pub_key -> {"rx": int, "tx": int}

def fetch_and_parse_data():
    global LAST_SERVER_TIME, LAST_SERVER_RX, LAST_SERVER_TX, LAST_PEER_STATS, GLOBAL_DATA
    
    for server in SERVERS:
        server_id = server["id"]
        server_name = server["name"]
        
        if MOCK_DATA:
            with open(os.path.join(os.path.dirname(__file__), 'mock_dump.txt'), 'r', encoding='utf-8') as f:
                output = f.read()
        else:
            docker_container = server.get("docker_container", "amnezia-awg")
            cmd1 = f"sudo docker exec -i {docker_container} awg show all dump"
            try:
                output1 = run_ssh_command(server, cmd1)
                
                cmd2 = f"sudo docker exec -i {docker_container} cat /opt/amnezia/awg/clientsTable"
                try:
                    output2 = run_ssh_command(server, cmd2)
                except Exception as e:
                    print(f"[{server_id}] Failed to fetch clientsTable: {e}")
                    output2 = "[]"
                    
                output = output1 + "\n---CLIENTS---\n" + output2
            except Exception as e:
                print(f"[{server_id}] SSH error: {e}")
                continue # Skip this server if error
            
        interface_info, peers = parse_awg_dump(output)
        
        total_rx = sum(p["transfer_rx"] for p in peers)
        total_tx = sum(p["transfer_tx"] for p in peers)
        
        now = time.time()
        current_mbps = 0.0
        
        if server_id in LAST_SERVER_TIME:
            time_diff = now - LAST_SERVER_TIME[server_id]
            if time_diff > 0:
                rx_diff = max(0, total_rx - LAST_SERVER_RX.get(server_id, 0))
                tx_diff = max(0, total_tx - LAST_SERVER_TX.get(server_id, 0))
                total_bytes = rx_diff + tx_diff
                current_mbps = (total_bytes * 8) / (time_diff * 1000000)
                
                peers_deltas = []
                for p in peers:
                    pk = p["public_key"]
                    peer_stats_map = LAST_PEER_STATS.get(server_id, {})
                    last_p = peer_stats_map.get(pk, {"rx": p["transfer_rx"], "tx": p["transfer_tx"]})
                    drx = max(0, p["transfer_rx"] - last_p["rx"])
                    dtx = max(0, p["transfer_tx"] - last_p["tx"])
                    peers_deltas.append((pk, drx, dtx))
                    
                database.save_stats(server_id, current_mbps, total_rx, total_tx, peers_deltas)
                
        # Update state for next tick
        LAST_SERVER_TIME[server_id] = now
        LAST_SERVER_RX[server_id] = total_rx
        LAST_SERVER_TX[server_id] = total_tx
        
        if server_id not in LAST_PEER_STATS:
            LAST_PEER_STATS[server_id] = {}
        for p in peers:
            LAST_PEER_STATS[server_id][p["public_key"]] = {"rx": p["transfer_rx"], "tx": p["transfer_tx"]}
            
        GLOBAL_DATA["servers"][server_id] = {
            "id": server_id,
            "name": server_name,
            "interface": interface_info,
            "stats": {
                "total_users": len(peers),
                "active_users": sum(1 for p in peers if p["is_online"]),
                "total_rx": total_rx,
                "total_tx": total_tx
            },
            "peers": peers,
            "current_mbps": round(current_mbps, 2),
            "avg_24h_mbps": database.get_24h_average_mbps(server_id),
            "history": database.get_recent_history(server_id, limit=20)
        }

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

def get_mock_stats():
    now = int(time.time())
    mock_data = {"servers": {}}
    for server in SERVERS:
        sid = server["id"]
        mock_data["servers"][sid] = {
            "id": sid,
            "name": server["name"],
            "interface": {"name": "awg0", "public_key": "mock_pub_key=", "listen_port": "51820"},
            "stats": {
                "total_users": 4,
                "active_users": 2,
                "total_rx": 1500000000,
                "total_tx": 2500000000
            },
            "peers": [
                {
                    "public_key": f"user1_pub_key_{sid}=",
                    "name": "Alice",
                    "group": "Engineering",
                    "allowed_ips": "10.8.0.2/32",
                    "endpoint": "192.168.1.100:54321",
                    "latest_handshake": now - 30,
                    "transfer_rx": 1000000000,
                    "transfer_tx": 1500000000,
                    "is_online": True
                },
                {
                    "public_key": f"user2_pub_key_{sid}=",
                    "name": "Bob",
                    "group": "Marketing",
                    "allowed_ips": "10.8.0.3/32",
                    "endpoint": "192.168.1.101:54322",
                    "latest_handshake": now - 150,
                    "transfer_rx": 500000000,
                    "transfer_tx": 1000000000,
                    "is_online": True
                },
                {
                    "public_key": f"user3_pub_key_{sid}=",
                    "name": "Charlie",
                    "group": "Engineering",
                    "allowed_ips": "10.8.0.4/32",
                    "endpoint": "(none)",
                    "latest_handshake": now - 86400,
                    "transfer_rx": 0,
                    "transfer_tx": 0,
                    "is_online": False
                },
                {
                    "public_key": f"user4_pub_key_{sid}=",
                    "name": "David",
                    "group": "",
                    "allowed_ips": "10.8.0.5/32",
                    "endpoint": "192.168.1.102:4444",
                    "latest_handshake": now - 3600,
                    "transfer_rx": 5000,
                    "transfer_tx": 2000,
                    "is_online": False
                }
            ],
            "current_mbps": 12.5,
            "avg_24h_mbps": 8.2,
            "history": [
                {"timestamp": now - 15, "mbps": 10.1},
                {"timestamp": now - 10, "mbps": 15.2},
                {"timestamp": now - 5, "mbps": 11.5},
                {"timestamp": now, "mbps": 12.5}
            ]
        }
    return mock_data

@app.get("/api/stats")
def get_stats():
    if MOCK_DATA:
        return get_mock_stats()
    return GLOBAL_DATA

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

frontend_dist_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist')

if os.path.exists(frontend_dist_dir):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_dist_dir, 'assets')), name="static")

@app.get("/{path:path}")
def serve_frontend(path: str):
    if path.startswith("api/") or path.startswith("static/"):
        raise HTTPException(status_code=404)
    file_path = os.path.join(frontend_dist_dir, path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(frontend_dist_dir, 'index.html'))

# Amnezia Traffic Monitor 🚀

A modern, real-time web dashboard for monitoring your AmneziaWG (WireGuard) VPN servers.

![Amnezia Traffic Monitor](frontend/public/favicon.svg) <!-- You can add a real screenshot here later -->

## Features
- **Multi-Server Support**: Monitor multiple Amnezia VPS instances from a single sleek dashboard.
- **Premium UI**: Dark-tech glassmorphism interface built with React, Vite, TailwindCSS v4, and Shadcn/ui.
- **Top Consumers Chart**: Beautiful Recharts bar charts showing your top 10 users by traffic consumption (RX/TX breakdown).
- **Real-Time Bandwidth**: Live Mbit/s network load monitoring with historical connection charts.
- **Dynamic Sorting & Filtering**: Instantly search by name or IP, and sort the peers table by Data Usage, RX, TX, or Status.
- **Historical Data**: 24h Average Load and bandwidth logging via a local SQLite database.
- **No Agent Installation Required**: Connects to your existing Amnezia VPS via SSH and reads the `awg show all dump` directly.

## How it works
The backend (FastAPI) runs a background thread that connects to your configured Amnezia VPS instances via SSH every X seconds. It reads the WireGuard interface dump, parses `clientsTable` for names, calculates traffic deltas, and saves the history to a local SQLite database. The frontend fetches this data to render the UI instantly.

## Installation & Usage (Docker)

The easiest way to run the monitor is via Docker.

1. Clone the repository:
   ```bash
   git clone https://github.com/IglFox/amnezia-traffic-viewer.git
   cd amnezia-traffic-viewer
   ```

2. Configure your servers:
   ```bash
   cp backend/servers.json.example backend/servers.json
   # Edit backend/servers.json and add your SSH credentials for each VPS
   ```

3. (Optional) Configure global settings:
   ```bash
   cp backend/.env.example backend/.env
   # Edit .env to change polling interval (default 10s)
   ```

4. Start the container:
   ```bash
   docker compose up -d --build
   ```

5. Open `http://localhost:8338` in your browser.

## Security Recommendations 🔒
**Do not use the `root` user for SSH!** 
It is highly recommended to create a restricted user on your VPS that is only allowed to run the specific dump commands.

1. On your VPS, create a user:
   ```bash
   sudo useradd -m -s /bin/bash amnezia-monitor
   sudo passwd amnezia-monitor
   ```
2. Allow them to run the docker exec commands via `sudo visudo`:
   ```text
   amnezia-monitor ALL=(root) NOPASSWD: /usr/bin/docker exec -i amnezia-awg awg show all dump, /usr/bin/docker exec -i amnezia-awg cat /opt/amnezia/awg/clientsTable
   ```
3. Update your `backend/servers.json` file to use `"ssh_user": "amnezia-monitor"`.

## Development (Running Locally)
If you want to modify the code or run it without Docker:

**Terminal 1 (Backend):**
```bash
pip install -r requirements.txt
uvicorn backend.main:app --port 8338 --reload
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm install
npm run dev
```

# Amnezia Traffic Monitor 🚀

A modern, real-time web dashboard for monitoring your AmneziaWG (WireGuard) VPN server.

![Amnezia Traffic Monitor](https://amnezia.org/favicon.ico) <!-- You can add a real screenshot here later -->

## Features
- **Real-Time Bandwidth**: Live Mbit/s network load monitoring.
- **Historical Data**: 24h Average Load and bandwidth logging via SQLite.
- **User Groups**: Assign names and group multiple devices (e.g. "Family", "Phone + PC") together to see aggregated traffic.
- **Dynamic Sorting & Filtering**: Instantly search by name, IP, or sort by data usage.
- **No Agent Installation Required**: Connects to your existing Amnezia VPS via SSH and reads the `awg show all dump` directly.

## How it works
The backend (FastAPI) runs a background thread that connects to your Amnezia VPS via SSH every X seconds. It reads the WireGuard interface dump, calculates traffic deltas, and saves the history to a local SQLite database. The frontend fetches this data to render the UI instantly.

## Installation & Usage (Docker)

The easiest way to run the monitor is via Docker.

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/amnezia-traffic-monitor.git
   cd amnezia-traffic-monitor
   ```

2. Configure your environment variables:
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your SSH credentials and server IP
   ```

3. Start the container:
   ```bash
   docker-compose up -d --build
   ```

4. Open `http://localhost:8338` in your browser.

## Security Recommendations 🔒
**Do not use the `root` user for SSH!** 
It is highly recommended to create a restricted user on your VPS that is only allowed to run the specific dump command.

1. On your VPS, create a user:
   ```bash
   sudo useradd -m -s /bin/bash amnezia-monitor
   sudo passwd amnezia-monitor
   ```
2. Allow them to run the docker exec command via `sudo visudo`:
   ```text
   amnezia-monitor ALL=(root) NOPASSWD: /usr/bin/docker exec -i amnezia-awg awg show all dump
   ```
3. Update your `.env` file to use `SSH_USER=amnezia-monitor`.

## Development (Running Locally)
If you want to modify the code or run it without Docker:

```bash
pip install -r requirements.txt
uvicorn backend.main:app --port 8338 --reload
```

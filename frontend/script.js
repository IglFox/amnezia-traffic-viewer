function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function timeSince(dateTimestamp) {
    if (!dateTimestamp) return "Never";
    const seconds = Math.floor(Date.now() / 1000) - dateTimestamp;
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

function createUserCard(peer) {
    const rx = peer.transfer_rx;
    const tx = peer.transfer_tx;
    const total = rx + tx;
    
    // Calculate percentages for the traffic bar
    const rxPercent = total > 0 ? (rx / total) * 100 : 50;
    const txPercent = total > 0 ? (tx / total) * 100 : 50;

    const statusClass = peer.is_online ? 'online' : 'offline';
    const statusText = peer.is_online ? 'Online' : 'Offline';
    const displayName = peer.name ? peer.name : `${peer.public_key.substring(0, 16)}...`;

    return `
        <div class="user-card">
            <div class="user-header">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div class="user-id" title="${peer.public_key}">
                        ${displayName}
                        <span class="edit-btn" onclick="updatePeerField('${peer.public_key}', 'name', '${peer.name || ''}')" style="cursor: pointer; opacity: 0.5; margin-left: 5px; font-size: 0.8rem;" title="Rename">✏️</span>
                    </div>
                    <div class="user-group" style="font-size: 0.75rem; color: #38bdf8; display: flex; align-items: center; gap: 4px;">
                        <span>📁 ${peer.group || 'Ungrouped'}</span>
                        <span class="edit-btn" onclick="updatePeerField('${peer.public_key}', 'group', '${peer.group || ''}')" style="cursor: pointer; opacity: 0.5; font-size: 0.7rem;" title="Change Group">✏️</span>
                    </div>
                </div>
                <div class="user-status ${statusClass}">
                    <div class="user-status-dot"></div>
                    ${statusText}
                </div>
            </div>
            
            <div class="user-details">
                <div class="detail-row">
                    <span class="detail-label">IPs</span>
                    <span>${peer.allowed_ips}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Endpoint</span>
                    <span>${peer.endpoint !== '(none)' ? peer.endpoint : 'Unknown'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Last Seen</span>
                    <span>${timeSince(peer.latest_handshake)}</span>
                </div>
                
                <div style="margin-top: 0.5rem;">
                    <div class="detail-row" style="font-size: 0.75rem;">
                        <span style="color: #10b981;">↓ ${formatBytes(rx)}</span>
                        <span style="color: #38bdf8;">↑ ${formatBytes(tx)}</span>
                    </div>
                    <div class="traffic-bar-container">
                        <div class="traffic-rx" style="width: ${rxPercent}%"></div>
                        <div class="traffic-tx" style="width: ${txPercent}%"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

let trafficChartInstance = null;
let chartGroupBy = 'device'; // 'device' or 'group'

function updateChart(peers) {
    const ctx = document.getElementById('trafficChart').getContext('2d');
    
    let aggregatedData = [];
    
    if (chartGroupBy === 'group') {
        const groupMap = {};
        peers.forEach(p => {
            const groupName = p.group || p.name || p.public_key.substring(0, 8);
            if (!groupMap[groupName]) {
                groupMap[groupName] = { label: groupName, rx: 0, tx: 0 };
            }
            groupMap[groupName].rx += p.transfer_rx;
            groupMap[groupName].tx += p.transfer_tx;
        });
        aggregatedData = Object.values(groupMap);
    } else {
        aggregatedData = peers.map(p => ({
            label: p.name || p.public_key.substring(0, 8),
            rx: p.transfer_rx,
            tx: p.transfer_tx
        }));
    }
    
    aggregatedData.sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
    const topData = aggregatedData.slice(0, 15);
    
    const labels = topData.map(d => d.label);
    const rxData = topData.map(d => d.rx / (1024 * 1024 * 1024)); // GB
    const txData = topData.map(d => d.tx / (1024 * 1024 * 1024)); // GB
    
    if (trafficChartInstance) {
        trafficChartInstance.data.labels = labels;
        trafficChartInstance.data.datasets[0].data = rxData;
        trafficChartInstance.data.datasets[1].data = txData;
        trafficChartInstance.update();
    } else {
        Chart.defaults.color = '#94a3b8';
        trafficChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Received (GB)',
                        data: rxData,
                        backgroundColor: '#10b981',
                        borderRadius: 4
                    },
                    {
                        label: 'Sent (GB)',
                        data: txData,
                        backgroundColor: '#38bdf8',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    y: {
                        stacked: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        title: { display: true, text: 'Traffic (GB)', color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + ' GB';
                            }
                        }
                    }
                }
            }
        });
    }
}

async function updatePeerField(publicKey, field, currentValue) {
    const promptText = field === 'name' ? "Enter device name:" : "Enter group name (e.g. 'John Doe'):";
    const newValue = prompt(promptText, currentValue);
    if (newValue !== null) {
        try {
            const body = { public_key: publicKey };
            body[field] = newValue.trim();
            
            await fetch('/api/update_peer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            fetchStats();
        } catch(e) {
            console.error("Update error", e);
        }
    }
}

let currentPeersData = [];

function renderGroups() {
    if (!currentPeersData) return;
    const groupMap = {};
    currentPeersData.forEach(p => {
        if (!p.group) return; // Only show actual groups
        if (!groupMap[p.group]) groupMap[p.group] = [];
        groupMap[p.group].push(p);
    });
    
    const groupsHtml = Object.keys(groupMap).map(groupName => {
        const peers = groupMap[groupName];
        const rx = peers.reduce((sum, p) => sum + p.transfer_rx, 0);
        const tx = peers.reduce((sum, p) => sum + p.transfer_tx, 0);
        const isOnline = peers.some(p => p.is_online);
        const total = rx + tx;
        const rxPercent = total > 0 ? (rx / total) * 100 : 50;
        const txPercent = total > 0 ? (tx / total) * 100 : 50;
        
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Online' : 'Offline';
        
        const peerNames = peers.map(p => p.name || p.public_key.substring(0,8)).join(', ');

        return `
            <div class="user-card" style="border: 1px solid rgba(56, 189, 248, 0.3);">
                <div class="user-header">
                    <div class="user-id" style="color: #38bdf8;">📁 ${groupName} <span style="font-size: 0.8em; color: var(--text-secondary)">(${peers.length} devices)</span></div>
                    <div class="user-status ${statusClass}">
                        <div class="user-status-dot"></div>
                        ${statusText}
                    </div>
                </div>
                
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.4; opacity: 0.8;">
                    ${peerNames}
                </div>
                
                <div class="user-details">
                    <div class="detail-row">
                        <span class="detail-label">Total RX</span>
                        <span class="detail-value" style="color: #10b981;">↓ ${formatBytes(rx)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total TX</span>
                        <span class="detail-value" style="color: #38bdf8;">↑ ${formatBytes(tx)}</span>
                    </div>
                </div>

                <div class="traffic-bar">
                    <div class="traffic-rx" style="width: ${rxPercent}%"></div>
                    <div class="traffic-tx" style="width: ${txPercent}%"></div>
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('groups-grid').innerHTML = groupsHtml;
}

function renderPeers() {
    if (!currentPeersData) return;
    
    const searchVal = document.getElementById('search-input').value.toLowerCase();
    const statusVal = document.getElementById('status-filter').value;
    const sortVal = document.getElementById('sort-filter').value;
    
    let filtered = currentPeersData.filter(peer => {
        const nameMatch = (peer.name && peer.name.toLowerCase().includes(searchVal)) || 
                          (peer.group && peer.group.toLowerCase().includes(searchVal)) || 
                          peer.public_key.toLowerCase().includes(searchVal) || 
                          peer.allowed_ips.includes(searchVal);
        if (!nameMatch) return false;
        
        if (statusVal === 'online' && !peer.is_online) return false;
        if (statusVal === 'offline' && peer.is_online) return false;
        
        return true;
    });
    
    filtered.sort((a, b) => {
        if (sortVal === 'traffic') {
            return (b.transfer_rx + b.transfer_tx) - (a.transfer_rx + a.transfer_tx);
        } else {
            return b.latest_handshake - a.latest_handshake;
        }
    });
    
    const grid = document.getElementById('users-grid');
    grid.innerHTML = filtered.map(createUserCard).join('');
}

// Add event listeners for filters
document.getElementById('search-input').addEventListener('input', renderPeers);
document.getElementById('status-filter').addEventListener('change', renderPeers);
document.getElementById('sort-filter').addEventListener('change', renderPeers);

document.getElementById('chart-group-toggle').addEventListener('change', (e) => {
    chartGroupBy = e.target.value;
    if (currentPeersData.length > 0) {
        updateChart(currentPeersData);
    }
});

// Removed obsolete lastStats tracking

async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        const now = Date.now();
        
        // Read Bandwidth from backend
        const mbps = data.current_mbps || 0;
        const avg_mbps = data.avg_24h_mbps || 0;
        
        document.getElementById('stat-bandwidth').innerHTML = `${mbps.toFixed(2)} <span style="font-size: 1.2rem; color: var(--text-secondary);">Mbit/s</span>`;
        document.getElementById('stat-avg-bandwidth').innerHTML = `${avg_mbps.toFixed(2)} <span style="font-size: 0.9rem; color: var(--text-secondary);">Mbit/s</span>`;
        
        let percent = (mbps / 500) * 100;
        if (percent > 100) percent = 100;
        
        const bar = document.getElementById('bandwidth-bar');
        bar.style.width = `${percent}%`;
        
        if (percent > 90) {
            bar.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
        } else if (percent > 70) {
            bar.style.background = 'linear-gradient(90deg, #10b981, #f59e0b)';
        } else {
            bar.style.background = 'linear-gradient(90deg, #10b981, #38bdf8)';
        }

        // Update stats
        document.getElementById('stat-total-users').textContent = data.stats.total_users;
        document.getElementById('stat-active-users').textContent = data.stats.active_users;
        document.getElementById('stat-total-tx').textContent = formatBytes(data.stats.total_tx);
        document.getElementById('stat-total-rx').textContent = formatBytes(data.stats.total_rx);
        
        // Save peers globally for filtering
        currentPeersData = data.peers;
        
        // Update user grid with filters
        renderPeers();
        
        // Update groups grid
        renderGroups();
        
        // Update Chart
        updateChart(data.peers);
        
        document.getElementById('connection-status').textContent = 'Live';
        document.querySelector('.pulse').style.backgroundColor = 'var(--status-online)';
    } catch (error) {
        console.error('Error fetching stats:', error);
        document.getElementById('connection-status').textContent = 'Offline';
        document.querySelector('.pulse').style.backgroundColor = 'var(--status-offline)';
    }
}

// Initialize app and polling
async function initApp() {
    try {
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        
        // Convert seconds to milliseconds
        const intervalMs = (config.update_interval_seconds || 10) * 1000;
        
        await fetchStats(); // Initial fetch
        setInterval(fetchStats, intervalMs);
    } catch (e) {
        console.error("Failed to load config, falling back to 10 seconds interval");
        await fetchStats();
        setInterval(fetchStats, 10 * 1000);
    }
}

initApp();

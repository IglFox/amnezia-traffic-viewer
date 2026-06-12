/* ============================================================
   Amnezia WG Monitor — Frontend Logic
   ============================================================ */

// --- SVG icon templates (Phosphor-style) ---
const ICONS = {
    pencil: `<svg viewBox="0 0 256 256"><path d="M224 76.57 179.43 32a16 16 0 0 0-22.63 0L36 152.77V220h67.23L224 98.83a16 16 0 0 0 0-22.26ZM93.66 204H52v-41.66L168 46.34 209.66 88Z" fill="currentColor"/></svg>`,
    folder: `<svg viewBox="0 0 256 256"><path d="M216 72h-84.69L104 44.69A15.86 15.86 0 0 0 92.69 40H40a16 16 0 0 0-16 16v144.62A15.4 15.4 0 0 0 39.38 216H216.89A15.13 15.13 0 0 0 232 200.89V88a16 16 0 0 0-16-16Zm0 128H40V56h52.69l30.63 30.63.68.68H216Z" fill="currentColor"/></svg>`,
};


// --- Utility: format bytes ---
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}


// --- Utility: relative time ---
function timeSince(dateTimestamp) {
    if (!dateTimestamp) return "Never";
    const seconds = Math.floor(Date.now() / 1000) - dateTimestamp;

    const intervals = [
        { label: 'year', s: 31536000 },
        { label: 'month', s: 2592000 },
        { label: 'day', s: 86400 },
        { label: 'hour', s: 3600 },
        { label: 'minute', s: 60 },
    ];

    for (const { label, s } of intervals) {
        const count = Math.floor(seconds / s);
        if (count >= 1) return `${count} ${label}${count > 1 ? 's' : ''} ago`;
    }
    return `${Math.floor(seconds)}s ago`;
}


// --- Inline edit ---
function startInlineEdit(publicKey, field, currentValue, triggerEl) {
    // Prevent double-edits
    if (triggerEl.closest('.user-card')?.querySelector('.inline-edit-input')) return;

    const container = triggerEl.parentElement;
    const originalContent = container.innerHTML;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit-input';
    input.value = currentValue;
    input.setAttribute('aria-label', `Edit ${field}`);

    // Clear container, show input
    container.innerHTML = '';
    container.appendChild(input);
    input.focus();
    input.select();

    async function save() {
        const newValue = input.value.trim();
        input.removeEventListener('blur', handleBlur);

        if (newValue !== currentValue) {
            try {
                const body = { public_key: publicKey };
                body[field] = newValue;
                await fetch('/api/update_peer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                fetchStats();
            } catch (e) {
                console.error('Update error', e);
                container.innerHTML = originalContent;
            }
        } else {
            container.innerHTML = originalContent;
        }
    }

    function cancel() {
        input.removeEventListener('blur', handleBlur);
        container.innerHTML = originalContent;
    }

    function handleBlur() {
        // Small delay to allow click events to fire first
        setTimeout(save, 80);
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    input.addEventListener('blur', handleBlur);
}


// --- Card templates ---
function createUserCard(peer, index) {
    const rx = peer.transfer_rx;
    const tx = peer.transfer_tx;
    const total = rx + tx;
    const rxPercent = total > 0 ? (rx / total) * 100 : 50;
    const txPercent = total > 0 ? (tx / total) * 100 : 50;

    const statusClass = peer.is_online ? 'online' : 'offline';
    const statusText = peer.is_online ? 'Online' : 'Offline';
    const displayName = peer.name || `${peer.public_key.substring(0, 16)}…`;
    const escapedName = (peer.name || '').replace(/'/g, "\\'");
    const escapedGroup = (peer.group || '').replace(/'/g, "\\'");

    const staggerClass = index < 8 ? `animate-in stagger-${index + 1}` : 'animate-in stagger-8';

    return `
        <div class="user-card ${staggerClass}">
            <div class="user-header">
                <div class="user-name-block">
                    <div class="user-id" title="${peer.public_key}">
                        <span>${displayName}</span>
                        <span class="edit-btn" onclick="startInlineEdit('${peer.public_key}', 'name', '${escapedName}', this)" title="Rename">
                            ${ICONS.pencil}
                        </span>
                    </div>
                    <div class="user-group-label">
                        <span class="edit-btn" style="width:16px;height:16px;" onclick="startInlineEdit('${peer.public_key}', 'group', '${escapedGroup}', this)" title="Change group">
                            ${ICONS.folder}
                        </span>
                        <span>${peer.group || 'Ungrouped'}</span>
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
                    <span class="detail-value">${peer.allowed_ips}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Endpoint</span>
                    <span class="detail-value">${peer.endpoint !== '(none)' ? peer.endpoint : 'Unknown'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Last seen</span>
                    <span class="detail-value">${timeSince(peer.latest_handshake)}</span>
                </div>
            </div>

            <div>
                <div class="traffic-stats-row">
                    <span class="traffic-rx-label">↓ ${formatBytes(rx)}</span>
                    <span class="traffic-tx-label">↑ ${formatBytes(tx)}</span>
                </div>
                <div class="traffic-bar-container">
                    <div class="traffic-rx" style="width: ${rxPercent}%"></div>
                    <div class="traffic-tx" style="width: ${txPercent}%"></div>
                </div>
            </div>
        </div>
    `;
}


// --- Chart ---
let trafficChartInstance = null;
let chartGroupBy = 'device';

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
            tx: p.transfer_tx,
        }));
    }

    aggregatedData.sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
    const topData = aggregatedData.slice(0, 15);

    const labels = topData.map(d => d.label);
    const rxData = topData.map(d => d.rx / (1024 * 1024 * 1024));
    const txData = topData.map(d => d.tx / (1024 * 1024 * 1024));

    if (trafficChartInstance) {
        trafficChartInstance.data.labels = labels;
        trafficChartInstance.data.datasets[0].data = rxData;
        trafficChartInstance.data.datasets[1].data = txData;
        trafficChartInstance.update();
    } else {
        Chart.defaults.color = '#7a8599';
        Chart.defaults.font.family = "'Geist', 'Inter', system-ui, sans-serif";

        trafficChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Received (GB)',
                        data: rxData,
                        backgroundColor: 'rgba(52, 211, 153, 0.75)',
                        borderRadius: 4,
                    },
                    {
                        label: 'Sent (GB)',
                        data: txData,
                        backgroundColor: 'rgba(124, 160, 212, 0.7)',
                        borderRadius: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { font: { size: 11 } },
                    },
                    y: {
                        stacked: true,
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        title: { display: true, text: 'Traffic (GB)', color: '#7a8599' },
                        ticks: { font: { size: 11 } },
                    },
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, padding: 20, font: { size: 12 } },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(12, 15, 20, 0.9)',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        titleFont: { weight: '600' },
                        callbacks: {
                            label: (context) =>
                                `${context.dataset.label}: ${context.parsed.y.toFixed(2)} GB`,
                        },
                    },
                },
            },
        });
    }
}


// --- Groups renderer ---
let currentPeersData = [];

function renderGroups() {
    if (!currentPeersData) return;
    const groupMap = {};
    currentPeersData.forEach(p => {
        if (!p.group) return;
        if (!groupMap[p.group]) groupMap[p.group] = [];
        groupMap[p.group].push(p);
    });

    const groupsHtml = Object.keys(groupMap).map((groupName, idx) => {
        const peers = groupMap[groupName];
        const rx = peers.reduce((sum, p) => sum + p.transfer_rx, 0);
        const tx = peers.reduce((sum, p) => sum + p.transfer_tx, 0);
        const isOnline = peers.some(p => p.is_online);
        const total = rx + tx;
        const rxPercent = total > 0 ? (rx / total) * 100 : 50;
        const txPercent = total > 0 ? (tx / total) * 100 : 50;

        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Online' : 'Offline';
        const peerNames = peers.map(p => p.name || p.public_key.substring(0, 8)).join(', ');
        const staggerClass = idx < 8 ? `animate-in stagger-${idx + 1}` : 'animate-in stagger-8';

        return `
            <div class="user-card user-card--group ${staggerClass}">
                <div class="user-header">
                    <div class="user-name-block">
                        <div class="user-id" style="color: var(--accent);">
                            <span style="display:inline-flex;width:14px;height:14px;flex-shrink:0;color:var(--accent);">${ICONS.folder}</span>
                            ${groupName}
                            <span class="group-device-count">(${peers.length} device${peers.length > 1 ? 's' : ''})</span>
                        </div>
                    </div>
                    <div class="user-status ${statusClass}">
                        <div class="user-status-dot"></div>
                        ${statusText}
                    </div>
                </div>

                <div class="group-members">${peerNames}</div>

                <div class="user-details">
                    <div class="detail-row">
                        <span class="detail-label">Total RX</span>
                        <span class="detail-value traffic-rx-label">↓ ${formatBytes(rx)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total TX</span>
                        <span class="detail-value traffic-tx-label">↑ ${formatBytes(tx)}</span>
                    </div>
                </div>

                <div class="traffic-bar-container">
                    <div class="traffic-rx" style="width: ${rxPercent}%"></div>
                    <div class="traffic-tx" style="width: ${txPercent}%"></div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('groups-grid').innerHTML = groupsHtml;
}


// --- Peers renderer ---
function renderPeers() {
    if (!currentPeersData) return;

    const searchVal = document.getElementById('search-input').value.toLowerCase();
    const statusVal = document.getElementById('status-filter').value;
    const sortVal = document.getElementById('sort-filter').value;

    let filtered = currentPeersData.filter(peer => {
        const nameMatch =
            (peer.name && peer.name.toLowerCase().includes(searchVal)) ||
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
        }
        return b.latest_handshake - a.latest_handshake;
    });

    const grid = document.getElementById('users-grid');
    grid.innerHTML = filtered.map((peer, i) => createUserCard(peer, i)).join('');
}


// --- Filter listeners ---
document.getElementById('search-input').addEventListener('input', renderPeers);
document.getElementById('status-filter').addEventListener('change', renderPeers);
document.getElementById('sort-filter').addEventListener('change', renderPeers);

document.getElementById('chart-group-toggle').addEventListener('change', (e) => {
    chartGroupBy = e.target.value;
    if (currentPeersData.length > 0) {
        updateChart(currentPeersData);
    }
});


// --- Skeleton helpers ---
function showSkeletons() {
    // Add skeleton class to key sections
    document.querySelectorAll('.stat-card, .chart-container').forEach(el => {
        el.classList.add('skeleton');
    });
}

function hideSkeletons() {
    document.querySelectorAll('.skeleton').forEach(el => {
        el.classList.remove('skeleton');
    });
}


// --- Data fetcher ---
async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        hideSkeletons();

        // Bandwidth
        const mbps = data.current_mbps || 0;
        const avg_mbps = data.avg_24h_mbps || 0;

        document.getElementById('stat-bandwidth').innerHTML =
            `${mbps.toFixed(2)} <span class="stat-unit">Mbit/s</span>`;
        document.getElementById('stat-avg-bandwidth').innerHTML =
            `${avg_mbps.toFixed(2)} <span class="stat-unit">Mbit/s</span>`;

        let percent = (mbps / 500) * 100;
        if (percent > 100) percent = 100;

        const bar = document.getElementById('bandwidth-bar');
        bar.style.width = `${percent}%`;

        if (percent > 90) {
            bar.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
        } else if (percent > 70) {
            bar.style.background = 'linear-gradient(90deg, var(--accent), #f59e0b)';
        } else {
            bar.style.background = 'linear-gradient(90deg, var(--accent), var(--tx-color))';
        }

        // Stats
        document.getElementById('stat-total-users').textContent = data.stats.total_users;
        document.getElementById('stat-active-users').textContent = data.stats.active_users;
        document.getElementById('stat-total-tx').textContent = formatBytes(data.stats.total_tx);
        document.getElementById('stat-total-rx').textContent = formatBytes(data.stats.total_rx);

        // Save peers globally
        currentPeersData = data.peers;

        renderPeers();
        renderGroups();
        updateChart(data.peers);

        document.getElementById('connection-status').textContent = 'Live';
        document.querySelector('.pulse').style.backgroundColor = '';

    } catch (error) {
        console.error('Error fetching stats:', error);
        document.getElementById('connection-status').textContent = 'Offline';
        document.querySelector('.pulse').style.backgroundColor = 'var(--status-offline)';
    }
}


// --- Init ---
async function initApp() {
    showSkeletons();

    try {
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        const intervalMs = (config.update_interval_seconds || 10) * 1000;

        await fetchStats();
        setInterval(fetchStats, intervalMs);
    } catch (e) {
        console.error('Failed to load config, falling back to 10s interval');
        await fetchStats();
        setInterval(fetchStats, 10_000);
    }
}

initApp();

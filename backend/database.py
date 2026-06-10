import sqlite3
import os
import time

DB_PATH = os.path.join(os.path.dirname(__file__), 'metrics.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS server_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            mbps REAL,
            total_rx INTEGER,
            total_tx INTEGER
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS peer_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            public_key TEXT,
            delta_rx INTEGER,
            delta_tx INTEGER
        )
    ''')
    conn.commit()
    conn.close()

def save_stats(mbps, total_rx, total_tx, peers_deltas):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    ts = int(time.time())
    
    c.execute('INSERT INTO server_stats (timestamp, mbps, total_rx, total_tx) VALUES (?, ?, ?, ?)',
              (ts, mbps, total_rx, total_tx))
              
    for pub_key, drx, dtx in peers_deltas:
        c.execute('INSERT INTO peer_stats (timestamp, public_key, delta_rx, delta_tx) VALUES (?, ?, ?, ?)',
                  (ts, pub_key, drx, dtx))
                  
    # Cleanup data older than 30 days
    cutoff = ts - (30 * 24 * 60 * 60)
    c.execute('DELETE FROM server_stats WHERE timestamp < ?', (cutoff,))
    c.execute('DELETE FROM peer_stats WHERE timestamp < ?', (cutoff,))
    
    conn.commit()
    conn.close()

def get_24h_average_mbps():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    cutoff = int(time.time()) - (24 * 60 * 60)
    c.execute('SELECT AVG(mbps) FROM server_stats WHERE timestamp >= ?', (cutoff,))
    row = c.fetchone()
    conn.close()
    return round(row[0], 2) if row and row[0] is not None else 0.0

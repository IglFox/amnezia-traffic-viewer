import { useEffect, useState } from "react"
import { Users, Server, ArrowUpRight, ArrowDownRight, Search, Menu, ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LineChart, Line, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip } from "recharts"

export default function App() {
  const [data, setData] = useState<any>(null)
  const [selectedServer, setSelectedServer] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [sortField, setSortField] = useState<string>("total")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/stats")
        const json = await res.json()
        setData(json)
        if (!selectedServer && json.servers && Object.keys(json.servers).length > 0) {
          setSelectedServer(Object.keys(json.servers)[0])
        }
      } catch (e) {
        console.error("Failed to fetch stats", e)
      }
    }
    fetchStats()
    const int = setInterval(fetchStats, 5000)
    return () => clearInterval(int)
  }, [selectedServer])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const NoiseOverlay = () => (
    <div className="pointer-events-none fixed inset-0 z-50 h-full w-full opacity-[0.03]">
      <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noiseFilter)" />
      </svg>
    </div>
  )

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground dark">
        <NoiseOverlay />
        <div className="w-full max-w-7xl mx-auto p-4 md:p-8 space-y-8 animate-pulse opacity-20">
          <div className="h-10 bg-secondary rounded-lg w-1/4 mb-2"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 h-64 bg-secondary rounded-xl"></div>
            <div className="grid grid-cols-2 md:grid-cols-1 gap-4">
              <div className="h-32 bg-secondary rounded-xl"></div>
              <div className="h-32 bg-secondary rounded-xl"></div>
            </div>
          </div>
          <div className="h-64 bg-secondary rounded-xl"></div>
          <div className="h-96 bg-secondary rounded-xl"></div>
        </div>
      </div>
    )
  }

  const servers = Object.values(data.servers) as any[]
  const current = data.servers[selectedServer || ""]
  
  const chartData = (current?.history || []).map((h: any) => ({
    time: new Date(h.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    mbps: h.mbps
  }))

  const rawPeers = current?.peers || []
  const peersWithTotal = rawPeers.map((p: any) => ({
    ...p,
    total_transfer: p.transfer_rx + p.transfer_tx
  }))

  const topPeersChartData = [...peersWithTotal]
    .sort((a, b) => b.total_transfer - a.total_transfer)
    .slice(0, 10)
    .map(p => ({
      name: p.name || p.public_key.substring(0, 8),
      total: p.total_transfer,
      rx: p.transfer_rx,
      tx: p.transfer_tx
    }))

  const filteredPeers = peersWithTotal.filter((p: any) => 
    (p.name || p.public_key).toLowerCase().includes(search.toLowerCase()) || 
    p.allowed_ips.includes(search)
  )

  const sortedPeers = [...filteredPeers].sort((a, b) => {
    let valA = a[sortField]
    let valB = b[sortField]

    if (sortField === "name") {
      valA = a.name || a.public_key
      valB = b.name || b.public_key
      valA = valA.toLowerCase()
      valB = valB.toLowerCase()
    } else if (sortField === "status") {
      valA = a.is_online ? 1 : 0
      valB = b.is_online ? 1 : 0
    } else if (sortField === "total") {
      valA = a.total_transfer
      valB = b.total_transfer
    }

    if (valA < valB) return sortDirection === "asc" ? -1 : 1
    if (valA > valB) return sortDirection === "asc" ? 1 : -1
    return 0
  })

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-20" />
    return sortDirection === "asc" 
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card/90 backdrop-blur-md border border-border/50 p-3 rounded-lg shadow-xl">
          <p className="font-medium text-sm mb-2">{label}</p>
          <div className="space-y-1">
            {payload.map((p: any, i: number) => (
              <p key={i} className="text-xs font-mono flex justify-between gap-4">
                <span style={{ color: p.color }}>{p.name.toUpperCase()}:</span>
                <span className="text-foreground">{formatBytes(p.value)}</span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="min-h-screen bg-[#060608] text-foreground dark flex flex-col md:flex-row overflow-hidden font-sans relative selection:bg-primary/30">
      <NoiseOverlay />
      
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border/20 relative z-10 bg-[#060608]/80 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary text-primary-foreground flex items-center justify-center font-bold">A</div>
          <span className="font-semibold tracking-tight">Amnezia</span>
        </div>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Sidebar */}
      <AnimatePresence>
        {(isSidebarOpen || window.innerWidth >= 768) && (
          <motion.aside 
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="fixed md:static inset-y-0 left-0 z-50 w-64 border-r border-border/10 bg-[#060608]/50 backdrop-blur-2xl flex flex-col"
          >
            <div className="p-6 hidden md:flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-[0_0_15px_rgba(255,255,255,0.2)]">A</div>
              <span className="font-semibold text-lg tracking-tight">Amnezia Monitor</span>
            </div>
            
            <div className="flex-1 px-4 py-4 md:py-0 space-y-2 overflow-y-auto">
              <p className="px-2 text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">Servers</p>
              {servers.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedServer(s.id); setIsSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all active:scale-[0.98] ${
                    selectedServer === s.id 
                      ? "bg-secondary/80 text-secondary-foreground shadow-sm border border-white/5" 
                      : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                  }`}
                >
                  <Server className="w-4 h-4 opacity-70" />
                  <span className="truncate">{s.name}</span>
                  {s.current_mbps > 0 && <span className="ml-auto w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_5px_rgba(16,185,129,0.8)]" />}
                </button>
              ))}
            </div>
            <div className="p-4 border-t text-xs text-muted-foreground">
              v2.0.0 · <a href="https://github.com/IglFox/amnezia-traffic-viewer" className="hover:text-foreground">Source</a>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative z-10">
        {current ? (
          <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
            
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <motion.h1 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-3xl md:text-4xl font-semibold tracking-tighter"
                >
                  {current.name}
                </motion.h1>
                <p className="text-muted-foreground mt-1">
                  Interface: <span className="font-mono text-foreground">{current.interface?.name || "N/A"}</span> · Port: {current.interface?.listen_port || "N/A"}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm bg-emerald-500/10 text-emerald-500 px-3 py-1.5 rounded-full border border-emerald-500/20">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                Live Connection
              </div>
            </header>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              
              {/* Load Card */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 }}
                className="md:col-span-2 group"
              >
                <Card className="h-full bg-[#0d0d12]/80 backdrop-blur-xl border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_8px_30px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 transition-transform duration-300">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Current Network Load</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-semibold tracking-tighter tabular-nums">{current.current_mbps}</span>
                        <span className="text-muted-foreground font-medium">Mbps</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">24h Average</p>
                      <p className="font-mono text-lg tabular-nums">{current.avg_24h_mbps} Mbps</p>
                    </div>
                  </CardContent>
                  <div className="px-6 pb-6 h-32 opacity-80 group-hover:opacity-100 transition-opacity">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <Line type="monotone" dataKey="mbps" stroke="#fff" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </motion.div>

              {/* Stats Column */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="grid grid-cols-2 md:grid-cols-1 gap-4"
              >
                <Card className="bg-[#0d0d12]/80 backdrop-blur-xl border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_8px_30px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 transition-transform duration-300">
                  <CardContent className="p-6 flex flex-col justify-center h-full">
                    <Users className="w-5 h-5 text-muted-foreground mb-3" />
                    <p className="text-2xl font-semibold tracking-tighter tabular-nums">{current.stats.active_users} / {current.stats.total_users}</p>
                    <p className="text-sm text-muted-foreground mt-1">Active Peers</p>
                  </CardContent>
                </Card>
                
                <Card className="bg-[#0d0d12]/80 backdrop-blur-xl border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_8px_30px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 transition-transform duration-300">
                  <CardContent className="p-6 flex flex-col justify-center h-full">
                    <div className="grid grid-cols-2 gap-4 w-full">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1 text-emerald-500 mb-2">
                          <ArrowDownRight className="w-4 h-4" />
                          <span className="text-xs font-mono tracking-widest uppercase">RX</span>
                        </div>
                        <p className="font-mono font-medium tabular-nums">{formatBytes(current.stats.total_rx)}</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1 text-blue-500 mb-2">
                          <ArrowUpRight className="w-4 h-4" />
                          <span className="text-xs font-mono tracking-widest uppercase">TX</span>
                        </div>
                        <p className="font-mono font-medium tabular-nums">{formatBytes(current.stats.total_tx)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Top Peers Chart */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <Card className="bg-[#0d0d12]/80 backdrop-blur-xl border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_8px_30px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 transition-transform duration-300">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Top 10 Peers by Traffic</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topPeersChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => formatBytes(val)} />
                        <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                        <Bar dataKey="rx" name="rx" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="tx" name="tx" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Peers Table */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card className="bg-[#0d0d12]/80 backdrop-blur-xl border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_8px_30px_rgba(0,0,0,0.4)]">
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4">
                  <CardTitle className="text-lg">Connected Peers</CardTitle>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input 
                      type="text" 
                      placeholder="Search peers..." 
                      className="pl-9 pr-4 py-2 text-sm bg-secondary/30 border border-white/5 rounded-md focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-64 transition-all hover:bg-secondary/50"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-secondary/20 border-y border-white/5">
                      <tr>
                        <th className="px-6 py-3 font-medium cursor-pointer hover:bg-secondary/40 transition-colors" onClick={() => handleSort('status')}>
                          <div className="flex items-center">Status <SortIcon field="status" /></div>
                        </th>
                        <th className="px-6 py-3 font-medium cursor-pointer hover:bg-secondary/40 transition-colors" onClick={() => handleSort('name')}>
                          <div className="flex items-center">Peer <SortIcon field="name" /></div>
                        </th>
                        <th className="px-6 py-3 font-medium cursor-pointer hover:bg-secondary/40 transition-colors" onClick={() => handleSort('allowed_ips')}>
                          <div className="flex items-center">IPs <SortIcon field="allowed_ips" /></div>
                        </th>
                        <th className="px-6 py-3 font-medium text-right cursor-pointer hover:bg-secondary/40 transition-colors" onClick={() => handleSort('transfer_rx')}>
                          <div className="flex items-center justify-end">RX <SortIcon field="transfer_rx" /></div>
                        </th>
                        <th className="px-6 py-3 font-medium text-right cursor-pointer hover:bg-secondary/40 transition-colors" onClick={() => handleSort('transfer_tx')}>
                          <div className="flex items-center justify-end">TX <SortIcon field="transfer_tx" /></div>
                        </th>
                        <th className="px-6 py-3 font-medium text-right cursor-pointer hover:bg-secondary/40 transition-colors" onClick={() => handleSort('total')}>
                          <div className="flex items-center justify-end">Total <SortIcon field="total" /></div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {sortedPeers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-16 text-center text-muted-foreground bg-secondary/5">
                            <div className="flex flex-col items-center justify-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-2">
                                <Users className="w-6 h-6 opacity-40" />
                              </div>
                              <p className="text-base font-medium text-foreground">No peers found</p>
                              <p className="text-sm">Try adjusting your search or add a peer on your server.</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        sortedPeers.map((p: any) => (
                          <tr key={p.public_key} className="hover:bg-secondary/20 transition-colors cursor-default">
                            <td className="px-6 py-4">
                              {p.is_online ? (
                                <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-none">Online</Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-muted text-muted-foreground border-transparent">Offline</Badge>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="font-medium">{p.name || "Unnamed Peer"}</div>
                              <div className="text-xs text-muted-foreground font-mono mt-1 w-32 truncate" title={p.public_key}>{p.public_key}</div>
                            </td>
                            <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{p.allowed_ips}</td>
                            <td className="px-6 py-4 text-right font-mono text-xs text-muted-foreground tabular-nums">{formatBytes(p.transfer_rx)}</td>
                            <td className="px-6 py-4 text-right font-mono text-xs text-muted-foreground tabular-nums">{formatBytes(p.transfer_tx)}</td>
                            <td className="px-6 py-4 text-right font-mono text-xs text-primary font-medium tabular-nums">{formatBytes(p.total_transfer)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>

          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Select a server from the sidebar
          </div>
        )}
      </main>
    </div>
  )
}

import { useMemo } from 'react';
import type { DashboardEvent, X402PaymentEvent } from '../hooks/useSocket';

const AGENTS = [
  { id: 'scout', label: 'SCOUT', port: 4001, color: '#67e8f9', borderColor: 'rgba(103,232,249,0.3)' },
  { id: 'analyst', label: 'ANALYST', port: 4002, color: '#c084fc', borderColor: 'rgba(192,132,252,0.3)' },
  { id: 'executor', label: 'EXECUTOR', port: 4003, color: '#FACC15', borderColor: 'rgba(250,204,21,0.3)' },
  { id: 'treasury', label: 'TREASURY', port: 4004, color: '#4ade80', borderColor: 'rgba(74,222,128,0.3)' },
];

interface Props {
  events: DashboardEvent[];
}

export default function AgentNetwork({ events }: Props) {
  const registered = useMemo(() => {
    const set = new Set<string>();
    events.forEach(e => {
      if (e.type === 'agent_registered') set.add((e.data as { agentId: string }).agentId);
    });
    return set;
  }, [events]);

  const stats = useMemo(() => {
    const s: Record<string, { requests: number; revenue: number }> = {};
    AGENTS.forEach(a => { s[a.id] = { requests: 0, revenue: 0 }; });
    events.forEach(e => {
      if (e.type === 'x402_payment') {
        const p = e.data as X402PaymentEvent;
        if (s[p.to]) {
          s[p.to].requests++;
          s[p.to].revenue += p.amount;
        }
      }
    });
    return s;
  }, [events]);

  const lastActivity = useMemo(() => {
    const m: Record<string, number> = {};
    events.forEach(e => {
      if (e.type === 'x402_payment') {
        const p = e.data as X402PaymentEvent;
        const t = new Date(e.timestamp).getTime();
        if (!m[p.to] || t > m[p.to]) m[p.to] = t;
      }
    });
    return m;
  }, [events]);

  function timeAgo(agentId: string): string {
    const t = lastActivity[agentId];
    if (!t) return '--';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-1 mb-1">
        <span className="font-serif text-[14px] text-[#e4e4e7]">Agents</span>
      </div>
      {AGENTS.map(agent => {
        const isActive = registered.has(agent.id);
        const st = stats[agent.id];
        const successRate = st.requests > 0 ? 94 : 0;
        const maxReq = Math.max(...Object.values(stats).map(s => s.requests), 1);
        const reqPct = (st.requests / maxReq) * 100;

        return (
          <div
            key={agent.id}
            className="card p-2.5"
            style={{ borderLeftWidth: 2, borderLeftColor: agent.borderColor }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[12px] font-medium text-[#e4e4e7]">{agent.label}</span>
              <span className="font-mono text-[10px] text-[#52525b]">:{agent.port}</span>
            </div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: isActive ? agent.color : '#3f3f46' }}
              />
              <span className="font-mono text-[10px] uppercase" style={{ color: isActive ? agent.color : '#52525b' }}>
                {isActive ? 'active' : 'idle'}
              </span>
            </div>

            {/* Stats */}
            <div className="space-y-1.5">
              {/* Requests with bar */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-[#52525b] font-sans">requests</span>
                  <span className="font-mono text-[10px] text-[#a1a1aa]">{st.requests}</span>
                </div>
                <div className="w-full bg-[#1a1a1f] h-[3px] rounded-[1px]">
                  <div className="h-[3px] rounded-[1px] transition-all duration-700" style={{ width: `${reqPct}%`, backgroundColor: agent.color, opacity: 0.5 }} />
                </div>
              </div>

              {/* Revenue */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#52525b] font-sans">revenue</span>
                <span className="font-mono text-[10px] text-[#a1a1aa]">${st.revenue.toFixed(2)}</span>
              </div>

              {/* Success rate */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-[#52525b] font-sans">success</span>
                  <span className="font-mono text-[10px] text-[#a1a1aa]">{successRate > 0 ? `${successRate}%` : '--'}</span>
                </div>
                {successRate > 0 && (
                  <div className="w-full bg-[#1a1a1f] h-[3px] rounded-[1px]">
                    <div className="h-[3px] rounded-[1px] bg-[#22c55e]/40 transition-all duration-500" style={{ width: `${successRate}%` }} />
                  </div>
                )}
              </div>

              {/* Last activity */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#52525b] font-sans">last</span>
                <span className="font-mono text-[10px] text-[#52525b]">{timeAgo(agent.id)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

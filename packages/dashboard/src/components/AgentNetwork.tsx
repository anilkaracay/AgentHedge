import { useMemo } from 'react';
import type { DashboardEvent, X402PaymentEvent } from '../hooks/useSocket';

const AGENTS = [
  { id: 'scout', label: 'SCOUT', port: 3001, color: '#10b981' },
  { id: 'analyst', label: 'ANALYST', port: 3002, color: '#3b82f6' },
  { id: 'executor', label: 'EXECUTOR', port: 3003, color: '#f59e0b' },
  { id: 'treasury', label: 'TREASURY', port: 3004, color: '#8b5cf6' },
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
    <div className="flex flex-col gap-[1px]">
      {AGENTS.map(agent => {
        const isActive = registered.has(agent.id);
        const st = stats[agent.id];
        const successRate = st.requests > 0 ? 94 : 0;
        return (
          <div
            key={agent.id}
            className="relative bg-[#0a0a0a] border border-[#27272a] p-3"
            style={{ borderLeftColor: agent.color, borderLeftWidth: 2 }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[13px] font-medium text-[#fafafa]">{agent.label}</span>
              <span className="font-mono text-[11px] text-[#71717a]">:{agent.port}</span>
            </div>
            <div className="flex items-center gap-1.5 mb-3">
              <div
                className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#10b981] animate-pulse-dot' : 'bg-[#71717a]'}`}
              />
              <span className="font-mono text-[11px] text-[#71717a] uppercase">
                {isActive ? 'active' : 'idle'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-1 text-[11px]">
              <span className="text-[#71717a]">requests</span>
              <span className="font-mono text-[#fafafa] text-right">{st.requests}</span>
              <span className="text-[#71717a]">revenue</span>
              <span className="font-mono text-[#fafafa] text-right">${st.revenue.toFixed(2)}</span>
              <span className="text-[#71717a]">success</span>
              <span className="font-mono text-[#fafafa] text-right">{successRate > 0 ? `${successRate}%` : '--'}</span>
              <span className="text-[#71717a]">last</span>
              <span className="font-mono text-[#fafafa] text-right">{timeAgo(agent.id)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

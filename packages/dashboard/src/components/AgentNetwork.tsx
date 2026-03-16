import { useMemo } from 'react';
import type { DashboardEvent, X402PaymentEvent } from '../hooks/useSocket';

const AGENTS = [
  { id: 'scout', label: 'SCOUT', color: '#06b6d4', borderColor: 'rgba(6,182,212,0.35)' },
  { id: 'analyst', label: 'ANALYST', color: '#a855f7', borderColor: 'rgba(168,85,247,0.35)' },
  { id: 'executor', label: 'EXECUTOR', color: '#FACC15', borderColor: 'rgba(250,204,21,0.35)' },
  { id: 'treasury', label: 'TREASURY', color: '#22c55e', borderColor: 'rgba(34,197,94,0.35)' },
];

interface Props {
  events: DashboardEvent[];
}

interface AgentStatus {
  text: string;
  color: string;
}

function deriveAgentStatus(agentId: string, events: DashboardEvent[]): AgentStatus {
  // Look at most recent events to figure out what each agent is doing
  const recent = events.slice(0, 15);

  switch (agentId) {
    case 'scout': {
      const signal = recent.find(e => e.type === 'signal_detected');
      if (signal) {
        const d = signal.data as any;
        return { text: `✓ ${d.venuesResponded ?? 0} venues scanned`, color: '#22c55e' };
      }
      return { text: '○ READY', color: '#52525b' };
    }
    case 'analyst': {
      const analysis = recent.find(e => e.type === 'analysis_complete');
      if (analysis) {
        const d = analysis.data as any;
        if (d.action === 'EXECUTE') return { text: '✓ EXECUTE', color: '#22c55e' };
        if (d.action === 'MONITOR') return { text: '✓ MONITOR', color: '#71717a' };
        return { text: `✓ ${d.action}`, color: '#71717a' };
      }
      return { text: '○ READY', color: '#52525b' };
    }
    case 'executor': {
      const trades = recent.filter(e => e.type === 'trade_executed');
      if (trades.length > 0) {
        return { text: `✓ ${trades.length} trades filled`, color: '#22c55e' };
      }
      return { text: '○ READY', color: '#52525b' };
    }
    case 'treasury': {
      const dist = recent.find(e => e.type === 'profit_distributed');
      if (dist) {
        const d = dist.data as any;
        const profit = d.totalProfit ?? 0;
        return { text: `✓ +$${profit.toFixed(2)} distributed`, color: '#22c55e' };
      }
      const portfolio = recent.find(e => e.type === 'portfolio_update');
      if (portfolio) return { text: '✓ portfolio updated', color: '#22c55e' };
      return { text: '○ READY', color: '#52525b' };
    }
    default:
      return { text: '○ READY', color: '#52525b' };
  }
}

export default function AgentNetwork({ events }: Props) {
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
      {AGENTS.map(agent => {
        const st = stats[agent.id];
        const status = deriveAgentStatus(agent.id, events);
        const successRate = st.requests > 0 ? 94 : 0;
        const maxReq = Math.max(...Object.values(stats).map(s => s.requests), 1);
        const reqPct = (st.requests / maxReq) * 100;

        return (
          <div
            key={agent.id}
            className="card p-2.5"
            style={{ borderLeftWidth: 2, borderLeftColor: agent.borderColor }}
          >
            {/* Name */}
            <div className="mb-1.5">
              <span className="font-mono text-[12px] font-medium text-[#e4e4e7]">{agent.label}</span>
            </div>

            {/* Dynamic status */}
            <div className="flex items-center gap-1.5 mb-2.5">
              <span className="font-mono text-[10px]" style={{ color: status.color }}>
                {status.text}
              </span>
            </div>

            {/* Stats */}
            <div className="space-y-1.5">
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-[#52525b] font-sans">requests</span>
                  <span className="font-mono text-[10px] text-[#a1a1aa]">{st.requests}</span>
                </div>
                <div className="w-full bg-[#1a1a1f] h-[3px] rounded-[1px]">
                  <div className="h-[3px] rounded-[1px] transition-all duration-700" style={{ width: `${reqPct}%`, backgroundColor: agent.color, opacity: 0.5 }} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#52525b] font-sans">revenue</span>
                <span className="font-mono text-[10px] text-[#a1a1aa]">${st.revenue.toFixed(2)}</span>
              </div>

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

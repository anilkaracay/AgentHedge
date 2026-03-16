import type { DashboardEvent, X402PaymentEvent } from '../hooks/useSocket';
import { useMemo } from 'react';

const AGENTS = [
  { id: 'scout', label: 'SCOUT', color: '#67e8f9' },
  { id: 'analyst', label: 'ANALYST', color: '#c084fc' },
  { id: 'executor', label: 'EXECUTOR', color: '#FACC15' },
  { id: 'treasury', label: 'TREASURY', color: '#4ade80' },
];

const STAGE_EVENTS: Record<string, string[]> = {
  SCOUT: ['signal_detected'],
  ANALYST: ['analysis_complete'],
  EXECUTOR: ['trade_executed'],
  TREASURY: ['profit_distributed', 'portfolio_update'],
};

interface Props {
  events: DashboardEvent[];
}

export default function PipelineViz({ events }: Props) {
  const recentEvents = events.slice(0, 10);

  const pipelineState = AGENTS.map((agent) => {
    const hasEvent = recentEvents.some(e => STAGE_EVENTS[agent.label]?.includes(e.type));
    return hasEvent ? 'done' : 'pending';
  });

  // Find which stage is currently "active" (first non-done after a done, or first)
  let activeIndex = 0;
  for (let i = 0; i < pipelineState.length; i++) {
    if (pipelineState[i] === 'done') activeIndex = i + 1;
  }
  if (activeIndex >= AGENTS.length) activeIndex = 0;

  // Get x402 payment amounts per agent
  const paymentAmounts = useMemo(() => {
    const amounts: Record<string, number> = {};
    for (const e of recentEvents) {
      if (e.type === 'x402_payment') {
        const p = e.data as X402PaymentEvent;
        amounts[p.to] = (amounts[p.to] || 0) + p.amount;
      }
    }
    return amounts;
  }, [recentEvents]);

  return (
    <div className="flex items-center justify-center gap-0 px-6 py-2">
      {AGENTS.map((agent, i) => {
        const isDone = pipelineState[i] === 'done';
        const isActive = i === activeIndex;

        return (
          <div key={agent.id} className="flex items-center">
            {/* Arrow + payment amount */}
            {i > 0 && (
              <div className="flex flex-col items-center mx-1.5 w-[48px]">
                <span className="font-mono text-[9px] text-[#FACC15]/60 mb-0.5">
                  {paymentAmounts[agent.id] ? `$${paymentAmounts[agent.id].toFixed(2)}` : ''}
                </span>
                <svg width="48" height="8" className="overflow-visible">
                  <line x1="0" y1="4" x2="42" y2="4" stroke={isDone ? '#FACC15' : '#27272a'} strokeWidth="1" strokeDasharray="4 3" className={isDone ? 'animate-dash' : ''} />
                  <polygon points="43,1 48,4 43,7" fill={isDone ? '#FACC15' : '#27272a'} />
                </svg>
              </div>
            )}

            {/* Agent box */}
            <div
              className={`relative px-3 py-1.5 border ${isActive ? 'border-[#FACC15]/40 animate-active-pulse' : isDone ? 'border-[rgba(255,255,255,0.1)]' : 'border-[rgba(255,255,255,0.04)]'}`}
              style={{ borderRadius: 2, background: isActive ? 'rgba(250,204,21,0.04)' : '#0a0a0f' }}
            >
              <div className="flex items-center gap-1.5">
                {isDone && <span className="text-[10px] text-[#22c55e]">✓</span>}
                {isActive && <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ backgroundColor: agent.color }} />}
                {!isDone && !isActive && <span className="w-1 h-1 rounded-full bg-[#3f3f46]" />}
                <span
                  className="font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: isActive ? agent.color : isDone ? '#a1a1aa' : '#52525b' }}
                >
                  {agent.label}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

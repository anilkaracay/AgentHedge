import { useState, useEffect } from 'react';
import { useDashboardEvents } from './hooks/useSocket';
import AgentNetwork from './components/AgentNetwork';
import PaymentStream from './components/PaymentStream';
import TradeHistory from './components/TradeHistory';
import RiskDashboard from './components/RiskDashboard';

const PIPELINE_STAGES = ['SCOUT', 'ANALYST', 'EXECUTOR', 'TREASURY'];

function App() {
  const { events, portfolio, payments, trades, connected, pnlHistory } = useDashboardEvents();
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setUptime(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const cycleCount = events.filter(e => e.type === 'cycle_complete').length;

  const fmt = (s: number) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  // Determine pipeline state from recent events
  const lastCycleEvents = events.slice(0, 10);
  const pipelineState = PIPELINE_STAGES.map((stage, i) => {
    const stageEvents: Record<string, string[]> = {
      SCOUT: ['signal_detected'],
      ANALYST: ['analysis_complete'],
      EXECUTOR: ['trade_executed'],
      TREASURY: ['profit_distributed', 'portfolio_update'],
    };
    const hasEvent = lastCycleEvents.some(e => stageEvents[stage]?.includes(e.type));
    return hasEvent ? 'done' : i === 0 ? 'active' : 'pending';
  });

  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-[#fafafa] overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 flex-shrink-0 border-b border-[#27272a] flex items-center justify-between px-4 bg-[#09090b]">
        <span className="font-mono text-[14px] font-medium tracking-tight">AgentHedge</span>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#10b981] animate-pulse-dot' : 'bg-[#ef4444]'}`} />
          <span className="font-mono text-[11px] text-[#71717a] uppercase">
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[11px] text-[#71717a]">CYCLE #{cycleCount}</span>
          <span className="font-mono text-[11px] text-[#a1a1aa]">{fmt(uptime)}</span>
        </div>
      </header>

      {/* Pipeline Status Bar */}
      <div className="h-10 flex-shrink-0 border-b border-[#27272a] flex items-center justify-center gap-0 px-4 bg-[#0a0a0a]">
        {PIPELINE_STAGES.map((stage, i) => (
          <div key={stage} className="flex items-center">
            {i > 0 && (
              <svg width="40" height="10" className="mx-1">
                <line
                  x1="0" y1="5" x2="40" y2="5"
                  stroke="#27272a"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  className={pipelineState[i - 1] === 'done' ? 'animate-dash' : ''}
                />
              </svg>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]">
                {pipelineState[i] === 'done' ? (
                  <span className="text-[#10b981]">{'\u2713'}</span>
                ) : pipelineState[i] === 'active' ? (
                  <span className="text-[#10b981]">{'\u25C9'}</span>
                ) : (
                  <span className="text-[#71717a]">{'\u00B7'}</span>
                )}
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${pipelineState[i] === 'active' ? 'text-[#10b981]' : pipelineState[i] === 'done' ? 'text-[#a1a1aa]' : 'text-[#71717a]'}`}>
                {stage}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Main 3-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Agent Status */}
        <div className="w-[280px] flex-shrink-0 border-r border-[#27272a] overflow-y-auto p-2">
          <AgentNetwork events={events} />
        </div>

        {/* Center Column: Trades + Payments */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0">
            <TradeHistory trades={trades} />
          </div>
          <div className="h-[200px] flex-shrink-0 border-t border-[#27272a]">
            <PaymentStream payments={payments} />
          </div>
        </div>

        {/* Right Column: Risk + Portfolio */}
        <div className="w-[320px] flex-shrink-0 border-l border-[#27272a] overflow-y-auto p-2">
          <RiskDashboard portfolio={portfolio} pnlHistory={pnlHistory} />
        </div>
      </div>
    </div>
  );
}

export default App;

import { useState, useEffect } from 'react';
import { useDashboardEvents } from './hooks/useSocket';
import AgentNetwork from './components/AgentNetwork';
import PaymentStream from './components/PaymentStream';
import TradeHistory from './components/TradeHistory';
import RiskDashboard from './components/RiskDashboard';
import ChainAttestations from './components/ChainAttestations';
import PipelineViz from './components/PipelineViz';

function App() {
  const { events, portfolio, payments, trades, pnlHistory, attestations, demoMode, toggleDemoMode } = useDashboardEvents();
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

  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-[#e4e4e7] overflow-hidden">
      {/* Demo Banner */}
      {demoMode && (
        <div className="h-6 flex-shrink-0 bg-[#FACC15]/5 border-b border-[#FACC15]/10 flex items-center justify-center px-2">
          <span className="demo-banner-text font-mono text-[10px] text-[#FACC15]/70 uppercase tracking-wider text-center">
            Demo Mode — Simulated portfolio, live prices
          </span>
        </div>
      )}

      {/* Top Bar */}
      <header className="h-11 flex-shrink-0 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between px-3 sm:px-4 bg-[#09090b]">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline header-logo">
            <span className="font-serif text-[16px] text-[#FACC15]">a</span>
            <span className="font-serif text-[16px] text-[#e4e4e7]">Hedge</span>
          </div>
        </div>

        <div className="header-center flex items-center gap-4">
          <button
            onClick={toggleDemoMode}
            className="flex items-center gap-1.5 px-2.5 py-1 border border-[rgba(255,255,255,0.06)] hover:border-[#FACC15]/30 transition-colors rounded-[2px]"
          >
            <span className="font-mono text-[10px] text-[#52525b] uppercase">Demo</span>
            <div className={`w-6 h-3 rounded-full relative transition-colors ${demoMode ? 'bg-[#FACC15]' : 'bg-[#27272a]'}`}>
              <div className={`absolute top-0.5 w-2 h-2 rounded-full bg-[#09090b] transition-all ${demoMode ? 'left-3.5' : 'left-0.5'}`} />
            </div>
          </button>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#52525b]">CYCLE</span>
            <span className="font-mono text-[12px] text-[#FACC15]">#{cycleCount}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[#3f3f46] hidden sm:inline">⏱</span>
          <span className="font-mono text-[12px] text-[#71717a]">{fmt(uptime)}</span>
        </div>
      </header>

      {/* Pipeline Visualization */}
      <div className="pipeline-bar flex-shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#0a0a0f]">
        <PipelineViz events={events} />
      </div>

      {/* Main 3-Column Layout (responsive via CSS) */}
      <div className="main-grid">
        {/* Left: Agent Cards */}
        <div className="sidebar-left border-r border-[rgba(255,255,255,0.06)] overflow-y-auto p-2">
          <AgentNetwork events={events} />
        </div>

        {/* Center: Trades + Payments */}
        <div className="center-col flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0 p-2">
            <TradeHistory trades={trades} events={events} />
          </div>
          <div className="h-[180px] flex-shrink-0 p-2 pt-0">
            <PaymentStream payments={payments} />
          </div>
        </div>

        {/* Right: Portfolio + Risk + Attestations */}
        <div className="sidebar-right border-l border-[rgba(255,255,255,0.06)] overflow-y-auto p-2">
          <RiskDashboard portfolio={portfolio} pnlHistory={pnlHistory} />
          <div className="mt-1.5">
            <ChainAttestations attestations={attestations} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

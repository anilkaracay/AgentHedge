import { useDashboardEvents } from './hooks/useSocket';
import AgentNetwork from './components/AgentNetwork';
import PaymentStream from './components/PaymentStream';
import TradeHistory from './components/TradeHistory';
import RiskDashboard from './components/RiskDashboard';
import { Activity } from 'lucide-react';

function App() {
  const { events, portfolio, payments, trades, connected, pnlHistory } = useDashboardEvents();

  const cycleEvents = events.filter((e) => e.type === 'cycle_complete');
  const lastCycle = cycleEvents[0]?.data as { cycleId?: number; result?: string } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center">
              <Activity size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">AgentHedge</h1>
              <p className="text-xs text-gray-500">Multi-Agent CeDeFi Arbitrage Swarm on X Layer</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {lastCycle && (
              <span className="text-xs text-gray-500 font-mono">
                Cycle #{lastCycle.cycleId} • {lastCycle.result}
              </span>
            )}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              <span className={`text-sm font-medium ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
                {connected ? 'Live' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="p-4 max-w-[1600px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-[calc(100vh-100px)]">
          {/* Left Column - 3/5 */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            {/* Agent Network */}
            <div className="h-[280px]">
              <AgentNetwork events={events} />
            </div>
            {/* Trade History */}
            <div className="flex-1 min-h-0">
              <TradeHistory trades={trades} />
            </div>
          </div>

          {/* Right Column - 2/5 */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Payment Stream */}
            <div className="h-[280px]">
              <PaymentStream payments={payments} />
            </div>
            {/* Risk Dashboard */}
            <div className="flex-1 min-h-0">
              <RiskDashboard portfolio={portfolio} pnlHistory={pnlHistory} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Shield, ShieldAlert, TrendingUp, TrendingDown } from 'lucide-react';
import type { PortfolioSnapshot } from '../hooks/useSocket';

interface Props {
  portfolio: PortfolioSnapshot | null;
  pnlHistory: { time: string; pnl: number }[];
}

export default function RiskDashboard({ portfolio, pnlHistory }: Props) {
  const pnl = portfolio?.dailyPnL ?? 0;
  const pnlPct = portfolio?.dailyPnLPercent ?? 0;
  const isPositive = pnl >= 0;
  const circuitBreaker = portfolio?.circuitBreakerActive ?? false;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Risk Dashboard
      </h2>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Portfolio Value */}
        <div className="bg-gray-800/50 rounded-lg p-3">
          <div className="text-gray-500 text-xs mb-1">Portfolio Value</div>
          <div className="text-2xl font-bold text-gray-100 font-mono">
            ${portfolio?.totalValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0.00'}
          </div>
        </div>

        {/* Daily P&L */}
        <div className="bg-gray-800/50 rounded-lg p-3">
          <div className="text-gray-500 text-xs mb-1">Daily P&L</div>
          <div className={`text-2xl font-bold font-mono flex items-center gap-1.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {isPositive ? '+' : ''}${pnl.toFixed(2)}
          </div>
          <div className={`text-xs mt-0.5 ${isPositive ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
            {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Circuit Breaker */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-4 ${circuitBreaker ? 'bg-red-400/10 border border-red-400/30' : 'bg-emerald-400/5 border border-emerald-400/20'}`}>
        {circuitBreaker ? <ShieldAlert size={16} className="text-red-400" /> : <Shield size={16} className="text-emerald-400" />}
        <span className={`text-sm font-medium ${circuitBreaker ? 'text-red-400' : 'text-emerald-400'}`}>
          Circuit Breaker: {circuitBreaker ? 'ACTIVE' : 'Normal'}
        </span>
        {circuitBreaker && (
          <span className="ml-auto text-xs text-red-400/60">Trading halted</span>
        )}
      </div>

      {/* Daily Loss Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Daily Loss Used</span>
          <span>{Math.min(100, Math.abs(Math.min(0, pnlPct)) / 5 * 100).toFixed(0)}% of 5% limit</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              Math.abs(Math.min(0, pnlPct)) > 4 ? 'bg-red-400' :
              Math.abs(Math.min(0, pnlPct)) > 2.5 ? 'bg-yellow-400' : 'bg-emerald-400'
            }`}
            style={{ width: `${Math.min(100, Math.abs(Math.min(0, pnlPct)) / 5 * 100)}%` }}
          />
        </div>
      </div>

      {/* P&L Chart */}
      <div className="flex-1 min-h-0">
        <div className="text-xs text-gray-500 mb-2">Cumulative P&L</div>
        {pnlHistory.length > 1 ? (
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={pnlHistory}>
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(value) => [`$${Number(value).toFixed(2)}`, 'P&L']}
              />
              <Line
                type="monotone"
                dataKey="pnl"
                stroke={isPositive ? '#34d399' : '#f87171'}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: isPositive ? '#34d399' : '#f87171' }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[120px] text-gray-600 text-sm">
            Waiting for data...
          </div>
        )}
      </div>
    </div>
  );
}

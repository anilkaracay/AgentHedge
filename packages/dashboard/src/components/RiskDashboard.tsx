import type { PortfolioSnapshot } from '../hooks/useSocket';

interface Props {
  portfolio: PortfolioSnapshot | null;
  pnlHistory: { time: string; pnl: number }[];
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 36;
  const w = 220;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const isPositive = data[data.length - 1] >= data[0];
  const color = isPositive ? '#FACC15' : '#ef4444';

  // Gradient fill area
  const areaPoints = `0,${h} ${points} ${(data.length - 1) * step},${h}`;

  return (
    <svg width={w} height={h} className="mt-2">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparkGrad)" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RiskDashboard({ portfolio, pnlHistory }: Props) {
  const pnl = portfolio?.dailyPnL ?? 0;
  const pnlPct = portfolio?.dailyPnLPercent ?? 0;
  const isPositive = pnl >= 0;
  const cb = portfolio?.circuitBreakerActive ?? false;
  const lossUsed = Math.min(100, Math.abs(Math.min(0, pnlPct)) / 5 * 100);
  const totalValue = portfolio?.totalValueUSD ?? 0;
  const balances = portfolio?.tokenBalances ?? [];

  const barColor = lossUsed > 80 ? '#ef4444' : lossUsed > 50 ? '#f59e0b' : '#22c55e';
  const tokenColors: Record<string, string> = { OKB: '#FACC15', USDT: '#22c55e', USDC: '#3b82f6' };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Portfolio */}
      <div className="card p-3">
        <div className="text-[10px] text-[#52525b] uppercase tracking-wider mb-3 border-b border-[rgba(255,255,255,0.06)] pb-1.5 font-sans">
          Portfolio
        </div>
        <div className="font-serif text-[26px] text-[#e4e4e7] leading-none mb-0.5">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="text-[10px] text-[#3f3f46] mb-3 font-sans">total value</div>
        <div className="flex items-baseline gap-3 mb-0.5">
          <span className={`font-serif text-[18px] ${isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
            {isPositive ? '+' : ''}${pnl.toFixed(2)}
          </span>
          <span className={`font-mono text-[11px] ${isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
            {isPositive ? '+' : ''}{pnlPct.toFixed(1)}%
          </span>
        </div>
        <div className="text-[10px] text-[#3f3f46] font-sans">session p&l</div>
        <Sparkline data={pnlHistory.map(p => p.pnl)} />
      </div>

      {/* Risk */}
      <div className="card p-3">
        <div className="text-[10px] text-[#52525b] uppercase tracking-wider mb-3 border-b border-[rgba(255,255,255,0.06)] pb-1.5 font-sans">
          Risk
        </div>
        <div className="grid grid-cols-2 gap-y-2 text-[11px] font-mono mb-3">
          <span className="text-[#52525b] font-sans text-[10px]">circuit breaker</span>
          <span className={`text-right font-medium font-mono ${cb ? 'text-[#ef4444] animate-pulse-dot' : 'text-[#22c55e]'}`}>
            {cb ? '⚠ ACTIVE' : '✓ OK'}
          </span>
          <span className="text-[#52525b] font-sans text-[10px]">daily loss</span>
          <span className="text-right text-[#a1a1aa] font-mono text-[10px]">{lossUsed.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-[#1a1a1f] h-[4px] rounded-[1px] mb-1">
          <div className="h-[4px] rounded-[1px] transition-all duration-500" style={{ width: `${lossUsed}%`, backgroundColor: barColor }} />
        </div>
        <div className="flex justify-between font-mono text-[9px] text-[#3f3f46]">
          <span>0%</span>
          <span>5% limit</span>
        </div>
      </div>

      {/* Allocation */}
      <div className="card p-3">
        <div className="text-[10px] text-[#52525b] uppercase tracking-wider mb-3 border-b border-[rgba(255,255,255,0.06)] pb-1.5 font-sans">
          Allocation
        </div>
        {balances.length === 0 ? (
          <div className="text-[11px] text-[#3f3f46] font-mono">No data</div>
        ) : (
          balances.map((b) => {
            const pct = totalValue > 0 ? (b.valueUSD / totalValue) * 100 : 0;
            const color = tokenColors[b.token] || '#71717a';
            return (
              <div key={b.token} className="mb-2.5">
                <div className="flex items-center justify-between font-mono text-[11px] mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#e4e4e7]">{b.token}</span>
                    <span className="text-[#52525b] text-[10px]">{parseFloat(b.balance).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#a1a1aa]">${b.valueUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className="text-[#52525b] w-[28px] text-right">{pct.toFixed(0)}%</span>
                  </div>
                </div>
                <div className="w-full bg-[#1a1a1f] h-[4px] rounded-[1px]">
                  <div className="h-[4px] rounded-[1px] transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.6 }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

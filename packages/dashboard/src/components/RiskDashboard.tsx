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
  const h = 32;
  const w = 200;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const isPositive = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="mt-2">
      <polyline
        points={points}
        fill="none"
        stroke={isPositive ? '#10b981' : '#ef4444'}
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

  const barColor = lossUsed > 80 ? '#ef4444' : lossUsed > 50 ? '#f59e0b' : '#10b981';

  return (
    <div className="flex flex-col gap-[1px]">
      {/* Portfolio */}
      <div className="bg-[#0a0a0a] border border-[#27272a] p-3">
        <div className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider mb-3 border-b border-[#27272a] pb-1.5">
          Portfolio
        </div>
        <div className="font-mono text-[28px] font-medium text-[#fafafa] leading-none mb-1">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="text-[11px] text-[#71717a] mb-3">total value</div>
        <div className="flex items-baseline gap-3 mb-1">
          <span className={`font-mono text-[16px] font-medium ${isPositive ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
            {isPositive ? '+' : ''}${pnl.toFixed(2)}
          </span>
          <span className={`font-mono text-[12px] ${isPositive ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
            {isPositive ? '+' : ''}{pnlPct.toFixed(1)}%
          </span>
        </div>
        <div className="text-[11px] text-[#71717a] mb-1">daily p&l</div>
        <Sparkline data={pnlHistory.map(p => p.pnl)} />
      </div>

      {/* Risk */}
      <div className="bg-[#0a0a0a] border border-[#27272a] p-3">
        <div className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider mb-3 border-b border-[#27272a] pb-1.5">
          Risk
        </div>
        <div className="grid grid-cols-2 gap-y-2 text-[11px] font-mono mb-3">
          <span className="text-[#71717a]">circuit breaker</span>
          <span className={`text-right font-medium ${cb ? 'text-[#ef4444] animate-pulse-dot' : 'text-[#10b981]'}`}>
            {cb ? 'ACTIVE' : 'OK'}
          </span>
          <span className="text-[#71717a]">daily loss used</span>
          <span className="text-right text-[#fafafa]">{lossUsed.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-[#27272a] h-1.5 mb-1">
          <div className="h-1.5 transition-all duration-500" style={{ width: `${lossUsed}%`, backgroundColor: barColor }} />
        </div>
        <div className="flex justify-between font-mono text-[9px] text-[#71717a]">
          <span>0%</span>
          <span>5% limit</span>
        </div>
      </div>

      {/* Allocation */}
      <div className="bg-[#0a0a0a] border border-[#27272a] p-3">
        <div className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider mb-3 border-b border-[#27272a] pb-1.5">
          Allocation
        </div>
        {balances.length === 0 ? (
          <div className="text-[11px] text-[#71717a]">No data</div>
        ) : (
          balances.map((b) => {
            const pct = totalValue > 0 ? (b.valueUSD / totalValue) * 100 : 0;
            return (
              <div key={b.token} className="mb-2">
                <div className="flex items-center justify-between font-mono text-[11px] mb-1">
                  <span className="text-[#fafafa]">{b.token}</span>
                  <div className="flex gap-3">
                    <span className="text-[#a1a1aa]">{parseFloat(b.balance).toFixed(3)}</span>
                    <span className="text-[#fafafa] w-[52px] text-right">${b.valueUSD.toFixed(2)}</span>
                    <span className="text-[#71717a] w-[28px] text-right">{pct.toFixed(0)}%</span>
                  </div>
                </div>
                <div className="w-full bg-[#27272a] h-1">
                  <div className="h-1 bg-[#10b981] transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

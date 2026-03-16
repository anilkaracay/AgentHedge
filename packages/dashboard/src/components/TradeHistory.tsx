import { useState } from 'react';
import type { TradeResult, DashboardEvent } from '../hooks/useSocket';

interface Props {
  trades: TradeResult[];
  events: DashboardEvent[];
}

export default function TradeHistory({ trades, events }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded(prev => prev === id ? null : id);

  // Build interleaved list: trades + monitor events between them
  const monitorEvents = events
    .filter(e => e.type === 'analysis_complete' && (e.data as any).action === 'MONITOR')
    .slice(0, 20);

  return (
    <div className="card flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <span className="font-serif text-[13px] text-[#e4e4e7]">Trade History</span>
        <span className="font-mono text-[10px] text-[#52525b]">{trades.length} trades</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-[11px] text-[#3f3f46]">Waiting for first trade...</span>
          </div>
        ) : (
          <div>
            {/* Header */}
            <div
              className="grid font-mono text-[10px] text-[#52525b] uppercase tracking-[0.05em] border-b border-[rgba(255,255,255,0.06)] px-3 py-1.5 bg-[#0f0f14]"
              style={{ gridTemplateColumns: '58px 72px 68px 72px 68px 68px 72px' }}
            >
              <span>Time</span>
              <span>Buy</span>
              <span className="text-right">Price</span>
              <span className="pl-2">Sell</span>
              <span className="text-right">Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Net P&L</span>
            </div>

            {/* Rows */}
            {trades.slice(0, 30).map((t: any, i) => {
              const id = t.tradeId || t.id || String(i);
              const buyVenue = t.buyVenue?.venue ?? '?';
              const buyPrice = t.buyVenue?.price ?? 0;
              const sellVenue = t.sellVenue?.venue ?? '?';
              const sellPrice = t.sellVenue?.price ?? 0;
              const size = t.size ?? parseFloat(t.amountIn || '0');
              const profit = t.netProfit ?? t.realizedProfit ?? 0;
              const isExpanded = expanded === id;

              // Check if there's a monitor event between this trade and the next
              const tradeTime = new Date(t.timestamp).getTime();
              const nextTrade = trades[i + 1] as any;
              const nextTime = nextTrade ? new Date(nextTrade.timestamp).getTime() : 0;
              const monitorBetween = nextTrade ? monitorEvents.find(m => {
                const mt = new Date(m.timestamp).getTime();
                return mt > nextTime && mt < tradeTime;
              }) : null;

              return (
                <div key={id}>
                  {/* Main trade row */}
                  <div
                    className={`trade-row grid font-mono text-[11px] px-3 py-1.5 cursor-pointer border-b border-[rgba(255,255,255,0.03)] ${i % 2 === 1 ? 'bg-[rgba(255,255,255,0.01)]' : ''} ${isExpanded ? 'bg-[rgba(250,204,21,0.04)] border-l-2 border-l-[#FACC15]' : ''} ${i === 0 ? 'animate-slide-in' : ''}`}
                    style={{ gridTemplateColumns: '58px 72px 68px 72px 68px 68px 72px' }}
                    onClick={() => toggle(id)}
                  >
                    <span className="text-[#52525b]">{new Date(t.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                    <span className="text-[#67e8f9] truncate">{buyVenue}</span>
                    <span className="text-right text-[#a1a1aa]">${buyPrice.toFixed(2)}</span>
                    <span className="pl-2 text-[#FACC15] truncate">{sellVenue}</span>
                    <span className="text-right text-[#a1a1aa]">${sellPrice.toFixed(2)}</span>
                    <span className="text-right text-[#71717a]">{size.toFixed(1)}</span>
                    <span className={`text-right font-medium flex items-center justify-end gap-1 ${profit > 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      <span className="text-[8px]">{profit > 0 ? '▲' : '▼'}</span>
                      {profit > 0 ? '+' : ''}${profit.toFixed(2)}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && <TradeDetail t={t} buyVenue={buyVenue} buyPrice={buyPrice} sellVenue={sellVenue} sellPrice={sellPrice} size={size} profit={profit} />}

                  {/* Monitor row between trades */}
                  {monitorBetween && (
                    <div className="px-3 py-1 border-b border-[rgba(255,255,255,0.03)] flex items-center gap-2 font-mono text-[10px]" style={{ opacity: 0.4 }}>
                      <span className="text-[#52525b]">{new Date(monitorBetween.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                      <span className="text-[#3f3f46]">· · ·</span>
                      <span className="text-[#71717a] uppercase">monitor</span>
                      <span className="text-[#71717a]">spread {((monitorBetween.data as any).estimatedSlippage ?? 0).toFixed(2)}%</span>
                      <span className="text-[#52525b]">·</span>
                      <span className="text-[#52525b]">below 0.32% threshold</span>
                      <span className="text-[#3f3f46]">· · ·</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TradeDetail({ t, buyVenue, buyPrice, sellVenue, sellPrice, size, profit }: {
  t: any; buyVenue: string; buyPrice: number; sellVenue: string; sellPrice: number; size: number; profit: number;
}) {
  const allVenues: any[] = t.allVenues || [];
  const minPrice = allVenues.length > 0 ? Math.min(...allVenues.map((v: any) => v.price)) : buyPrice;
  const maxPrice = allVenues.length > 0 ? Math.max(...allVenues.map((v: any) => v.price)) : sellPrice;
  const priceRange = maxPrice - minPrice || 1;

  return (
    <div className="bg-[#0c0c12] border-y border-[rgba(255,255,255,0.06)] px-4 py-3 text-[10px] font-mono animate-slide-in">
      {/* Buy/Sell side cards */}
      <div className="flex gap-3 mb-3">
        <div className="flex-1 bg-[#0a0a0f] border border-[rgba(103,232,249,0.15)] p-2.5 rounded-[2px]">
          <div className="text-[9px] text-[#67e8f9] uppercase tracking-wider mb-2 font-sans">Buy Side</div>
          <div className="space-y-1">
            <div className="flex justify-between"><span className="text-[#52525b]">Venue</span><span className="text-[#e4e4e7]">{buyVenue} ({t.buyVenue?.type ?? 'cex'})</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Price</span><span className="text-[#e4e4e7]">${buyPrice.toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Amount</span><span className="text-[#e4e4e7]">{size.toFixed(4)} OKB</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Total</span><span className="text-[#e4e4e7]">${(t.sizeUSD ?? size * buyPrice).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Fee</span><span className="text-[#ef4444]">-${(t.buyFee ?? 0).toFixed(2)}</span></div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center w-8 text-[#3f3f46]">
          <svg width="20" height="12"><line x1="0" y1="6" x2="14" y2="6" stroke="#FACC15" strokeWidth="1" opacity="0.4" /><polygon points="15,3 20,6 15,9" fill="#FACC15" opacity="0.4" /></svg>
        </div>

        <div className="flex-1 bg-[#0a0a0f] border border-[rgba(250,204,21,0.15)] p-2.5 rounded-[2px]">
          <div className="text-[9px] text-[#FACC15] uppercase tracking-wider mb-2 font-sans">Sell Side</div>
          <div className="space-y-1">
            <div className="flex justify-between"><span className="text-[#52525b]">Venue</span><span className="text-[#e4e4e7]">{sellVenue} ({t.sellVenue?.type ?? 'cex'})</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Price</span><span className="text-[#e4e4e7]">${sellPrice.toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Amount</span><span className="text-[#e4e4e7]">{size.toFixed(4)} OKB</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Total</span><span className="text-[#e4e4e7]">${(size * sellPrice).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-[#52525b]">Fee</span><span className="text-[#ef4444]">-${(t.sellFee ?? 0).toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      {/* Cost breakdown */}
      <div className="bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] p-2.5 rounded-[2px] mb-3">
        <div className="text-[9px] text-[#71717a] uppercase tracking-wider mb-2 font-sans">Cost Breakdown</div>
        <div className="space-y-1 max-w-[300px]">
          <div className="flex justify-between"><span className="text-[#52525b]">Spread</span><span className="text-[#e4e4e7]">{(t.spreadPercent ?? 0).toFixed(2)}%</span></div>
          <div className="flex justify-between"><span className="text-[#52525b]">Transfer</span><span className="text-[#22c55e]">$0.00 <span className="text-[#3f3f46]">✓ pre-positioned</span></span></div>
          <div className="flex justify-between"><span className="text-[#52525b]">Total costs</span><span className="text-[#ef4444]">-${(t.totalCosts ?? 0).toFixed(2)}</span></div>
          <div className="border-t border-[rgba(255,255,255,0.06)] my-1 pt-1" />
          <div className="flex justify-between"><span className="text-[#a1a1aa]">Gross</span><span className="text-[#22c55e]">+${(t.grossProfit ?? 0).toFixed(2)}</span></div>
          <div className="flex justify-between items-center">
            <span className="text-[#e4e4e7] font-medium">Net P&L</span>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${profit > 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>{profit > 0 ? '+' : ''}${profit.toFixed(2)}</span>
              {/* Mini profit bar */}
              <div className="w-[60px] bg-[#1a1a1f] h-[4px] rounded-[1px]">
                <div className="h-[4px] rounded-[1px]" style={{
                  width: `${Math.min(100, Math.max(5, profit / (t.grossProfit || 1) * 100))}%`,
                  backgroundColor: profit > 0 ? '#22c55e' : '#ef4444',
                }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Venue price bars */}
      {allVenues.length > 0 && (
        <div className="bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] p-2.5 rounded-[2px]">
          <div className="text-[9px] text-[#71717a] uppercase tracking-wider mb-2 font-sans">Venue Prices</div>
          <div className="space-y-1.5">
            {allVenues.map((v: any) => {
              const isBuy = v.venue === buyVenue;
              const isSell = v.venue === sellVenue;
              const barWidth = ((v.price - minPrice) / priceRange) * 100;
              const barColor = isBuy ? '#67e8f9' : isSell ? '#FACC15' : '#3f3f46';

              return (
                <div key={v.venue} className="flex items-center gap-2">
                  <span className={`w-[56px] text-right text-[10px] truncate ${isBuy ? 'text-[#67e8f9]' : isSell ? 'text-[#FACC15]' : 'text-[#52525b]'}`}>
                    {v.venue}
                  </span>
                  <div className="flex-1 bg-[#1a1a1f] h-[6px] rounded-[1px] relative">
                    <div className="venue-bar absolute left-0 top-0" style={{ width: `${Math.max(4, barWidth)}%`, backgroundColor: barColor, opacity: isBuy || isSell ? 0.7 : 0.25 }} />
                  </div>
                  <span className={`w-[52px] text-right text-[10px] ${isBuy || isSell ? 'text-[#a1a1aa]' : 'text-[#3f3f46]'}`}>
                    ${v.price.toFixed(2)}
                  </span>
                  {isBuy && <span className="text-[8px] text-[#67e8f9]">◄ BUY</span>}
                  {isSell && <span className="text-[8px] text-[#FACC15]">◄ SELL</span>}
                  {!isBuy && !isSell && <span className="w-[36px]" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

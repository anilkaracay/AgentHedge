import { useState } from 'react';
import type { TradeResult } from '../hooks/useSocket';

interface Props {
  trades: TradeResult[];
}

export default function TradeHistory({ trades }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded(prev => prev === id ? null : id);

  return (
    <div className="bg-[#0a0a0a] border border-[#27272a] flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[#27272a] flex items-center justify-between">
        <span className="font-mono text-[11px] text-[#71717a] uppercase tracking-wider">Trade History</span>
        <span className="font-mono text-[10px] text-[#71717a]">{trades.length} trades</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#71717a] text-[12px]">Waiting for first trade...</div>
        ) : (
          <div>
            {/* Header */}
            <div className="grid font-mono text-[10px] text-[#71717a] uppercase tracking-wider border-b border-[#27272a] px-2 py-1.5"
              style={{ gridTemplateColumns: '64px 80px 72px 80px 72px 80px 72px' }}>
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

              return (
                <div key={id}>
                  {/* Main row */}
                  <div
                    className={`grid font-mono text-[11px] px-2 py-1.5 cursor-pointer border-b border-[#27272a]/30 hover:bg-[#0f0f0f] ${i % 2 === 1 ? 'bg-[#0c0c0c]' : ''} ${isExpanded ? 'bg-[#10b981]/5 border-l-2 border-l-[#10b981]' : ''}`}
                    style={{ gridTemplateColumns: '64px 80px 72px 80px 72px 80px 72px' }}
                    onClick={() => toggle(id)}
                  >
                    <span className="text-[#a1a1aa]">{new Date(t.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                    <span className="text-[#10b981] truncate">{buyVenue}</span>
                    <span className="text-right text-[#a1a1aa]">${buyPrice.toFixed(2)}</span>
                    <span className="pl-2 text-[#f59e0b] truncate">{sellVenue}</span>
                    <span className="text-right text-[#a1a1aa]">${sellPrice.toFixed(2)}</span>
                    <span className="text-right text-[#a1a1aa]">{size.toFixed(1)}</span>
                    <span className={`text-right font-medium ${profit > 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                      {profit > 0 ? '+' : ''}${profit.toFixed(2)}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="bg-[#0a0a0a] border-y border-[#27272a] px-4 py-3 text-[10px] font-mono">
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <div className="text-[#71717a] uppercase tracking-wider mb-1.5 text-[9px]">Buy Side</div>
                          <div className="space-y-0.5">
                            <div className="flex justify-between"><span className="text-[#71717a]">Venue</span><span>{buyVenue} ({t.buyVenue?.type ?? 'cex'})</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Price</span><span>${buyPrice.toFixed(4)}</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Amount</span><span>{size.toFixed(4)} OKB</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Total</span><span>${(t.sizeUSD ?? size * buyPrice).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Fee</span><span className="text-[#ef4444]">-${(t.buyFee ?? 0).toFixed(2)}</span></div>
                          </div>
                        </div>
                        <div>
                          <div className="text-[#71717a] uppercase tracking-wider mb-1.5 text-[9px]">Sell Side</div>
                          <div className="space-y-0.5">
                            <div className="flex justify-between"><span className="text-[#71717a]">Venue</span><span>{sellVenue} ({t.sellVenue?.type ?? 'cex'})</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Price</span><span>${sellPrice.toFixed(4)}</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Amount</span><span>{size.toFixed(4)} OKB</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Total</span><span>${(size * sellPrice).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-[#71717a]">Fee</span><span className="text-[#ef4444]">-${(t.sellFee ?? 0).toFixed(2)}</span></div>
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-[#27272a] pt-2 space-y-0.5 max-w-[280px]">
                        <div className="flex justify-between"><span className="text-[#71717a]">Spread</span><span>{(t.spreadPercent ?? 0).toFixed(2)}%</span></div>
                        <div className="flex justify-between"><span className="text-[#71717a]">Transfer</span><span className="text-[#10b981]">$0.00</span></div>
                        <div className="flex justify-between"><span className="text-[#71717a]">Total costs</span><span className="text-[#ef4444]">-${(t.totalCosts ?? 0).toFixed(2)}</span></div>
                        <div className="flex justify-between border-t border-[#27272a] pt-1 mt-1">
                          <span className="text-[#fafafa]">Gross</span><span className="text-[#10b981]">+${(t.grossProfit ?? 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#fafafa] font-medium">Net P&L</span>
                          <span className={`font-medium ${profit > 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>{profit > 0 ? '+' : ''}${profit.toFixed(2)}</span>
                        </div>
                      </div>
                      {t.allVenues && t.allVenues.length > 0 && (
                        <div className="border-t border-[#27272a] mt-2 pt-2">
                          <div className="text-[#71717a] uppercase tracking-wider mb-1 text-[9px]">All Venues</div>
                          <div className="flex gap-3 flex-wrap">
                            {t.allVenues.map((v: any) => (
                              <span key={v.venue} className={v.venue === buyVenue ? 'text-[#10b981]' : v.venue === sellVenue ? 'text-[#f59e0b]' : 'text-[#71717a]'}>
                                {v.venue} ${v.price.toFixed(2)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
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

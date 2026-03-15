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
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-[#71717a] uppercase tracking-wider border-b border-[#27272a]">
                <th className="text-left py-1.5 px-2 font-medium">Time</th>
                <th className="text-left py-1.5 px-1 font-medium">Buy</th>
                <th className="text-right py-1.5 px-1 font-medium">Price</th>
                <th className="text-left py-1.5 px-1 font-medium">Sell</th>
                <th className="text-right py-1.5 px-1 font-medium">Price</th>
                <th className="text-right py-1.5 px-1 font-medium">Size</th>
                <th className="text-right py-1.5 px-2 font-medium">Net P&L</th>
              </tr>
            </thead>
            <tbody>
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
                  <tr key={id} className="cursor-pointer" onClick={() => toggle(id)}>
                    <td colSpan={7} className="p-0">
                      {/* Main row */}
                      <div className={`flex items-center hover:bg-[#0f0f0f] ${i % 2 === 1 ? 'bg-[#0c0c0c]' : ''} ${isExpanded ? 'bg-[#10b981]/5 border-l-2 border-l-[#10b981]' : ''}`}>
                        <span className="py-1.5 px-2 w-[60px] text-[#a1a1aa]">{new Date(t.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                        <span className="py-1.5 px-1 w-[80px] text-[#10b981]">{buyVenue}</span>
                        <span className="py-1.5 px-1 w-[80px] text-right text-[#a1a1aa]">${buyPrice.toFixed(2)}</span>
                        <span className="py-1.5 px-1 w-[80px] text-[#f59e0b]">{sellVenue}</span>
                        <span className="py-1.5 px-1 w-[80px] text-right text-[#a1a1aa]">${sellPrice.toFixed(2)}</span>
                        <span className="py-1.5 px-1 flex-1 text-right text-[#a1a1aa]">{size.toFixed(1)} OKB</span>
                        <span className={`py-1.5 px-2 w-[80px] text-right font-medium ${profit > 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                          {profit > 0 ? '+' : ''}${profit.toFixed(2)}
                        </span>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="bg-[#0a0a0a] border-t border-b border-[#27272a] px-4 py-3 text-[10px]">
                          <div className="grid grid-cols-2 gap-4 mb-3">
                            {/* Buy side */}
                            <div>
                              <div className="text-[#71717a] uppercase tracking-wider mb-1.5 text-[9px]">Buy Side</div>
                              <div className="grid grid-cols-2 gap-y-1">
                                <span className="text-[#71717a]">Venue</span><span className="text-right">{buyVenue} ({t.buyVenue?.type ?? 'cex'})</span>
                                <span className="text-[#71717a]">Price</span><span className="text-right">${buyPrice.toFixed(4)}</span>
                                <span className="text-[#71717a]">Amount</span><span className="text-right">{size.toFixed(4)} OKB</span>
                                <span className="text-[#71717a]">Total</span><span className="text-right">${(t.sizeUSD ?? size * buyPrice).toFixed(2)}</span>
                                <span className="text-[#71717a]">Fee</span><span className="text-right text-[#ef4444]">-${(t.buyFee ?? 0).toFixed(2)}</span>
                              </div>
                            </div>
                            {/* Sell side */}
                            <div>
                              <div className="text-[#71717a] uppercase tracking-wider mb-1.5 text-[9px]">Sell Side</div>
                              <div className="grid grid-cols-2 gap-y-1">
                                <span className="text-[#71717a]">Venue</span><span className="text-right">{sellVenue} ({t.sellVenue?.type ?? 'cex'})</span>
                                <span className="text-[#71717a]">Price</span><span className="text-right">${sellPrice.toFixed(4)}</span>
                                <span className="text-[#71717a]">Amount</span><span className="text-right">{size.toFixed(4)} OKB</span>
                                <span className="text-[#71717a]">Total</span><span className="text-right">${(size * sellPrice).toFixed(2)}</span>
                                <span className="text-[#71717a]">Fee</span><span className="text-right text-[#ef4444]">-${(t.sellFee ?? 0).toFixed(2)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Costs + P&L */}
                          <div className="border-t border-[#27272a] pt-2 mt-2">
                            <div className="grid grid-cols-2 gap-y-1 max-w-[300px]">
                              <span className="text-[#71717a]">Spread</span><span className="text-right">{(t.spreadPercent ?? 0).toFixed(2)}%</span>
                              <span className="text-[#71717a]">Transfer</span><span className="text-right text-[#10b981]">$0.00 (pre-positioned)</span>
                              <span className="text-[#71717a]">Agent fees</span><span className="text-right">-$0.05</span>
                              <span className="text-[#71717a]">Total costs</span><span className="text-right text-[#ef4444]">-${(t.totalCosts ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="border-t border-[#27272a] mt-2 pt-2 grid grid-cols-2 max-w-[300px]">
                              <span className="text-[#fafafa] font-medium">Gross</span><span className="text-right text-[#10b981]">+${(t.grossProfit ?? 0).toFixed(2)}</span>
                              <span className="text-[#fafafa] font-medium">Net P&L</span>
                              <span className={`text-right font-medium ${profit > 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                                {profit > 0 ? '+' : ''}${profit.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          {/* All venues at time of trade */}
                          {t.allVenues && t.allVenues.length > 0 && (
                            <div className="border-t border-[#27272a] mt-2 pt-2">
                              <div className="text-[#71717a] uppercase tracking-wider mb-1 text-[9px]">Venue Prices</div>
                              <div className="flex gap-3 flex-wrap">
                                {t.allVenues.map((v: any) => (
                                  <span key={v.venue} className={`${v.venue === buyVenue ? 'text-[#10b981]' : v.venue === sellVenue ? 'text-[#f59e0b]' : 'text-[#71717a]'}`}>
                                    {v.venue} ${v.price.toFixed(2)}{v.venue === buyVenue ? ' BUY' : v.venue === sellVenue ? ' SELL' : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

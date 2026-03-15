import type { TradeResult } from '../hooks/useSocket';

interface Props {
  trades: TradeResult[];
}

export default function TradeHistory({ trades }: Props) {
  return (
    <div className="bg-[#0a0a0a] border border-[#27272a] flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[#27272a] flex items-center justify-between">
        <span className="font-mono text-[11px] text-[#71717a] uppercase tracking-wider">Trade History</span>
        <span className="font-mono text-[10px] text-[#71717a]">{trades.length} trades</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-[#71717a] uppercase tracking-wider border-b border-[#27272a]">
              <th className="text-left py-1.5 px-3 font-medium">Time</th>
              <th className="text-left py-1.5 px-1 font-medium">Pair</th>
              <th className="text-right py-1.5 px-1 font-medium">Amount</th>
              <th className="text-right py-1.5 px-1 font-medium">Output</th>
              <th className="text-right py-1.5 px-1 font-medium">Profit</th>
              <th className="text-center py-1.5 px-1 font-medium">Status</th>
              <th className="text-right py-1.5 px-3 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-[#71717a] text-[12px]">
                  Waiting for first trade...
                </td>
              </tr>
            ) : (
              trades.slice(0, 20).map((t, i) => {
                const profit = t.realizedProfit ?? 0;
                return (
                  <tr key={t.id} className={i % 2 === 1 ? 'bg-[#0f0f0f]' : ''}>
                    <td className="py-1.5 px-3 text-[#a1a1aa]">
                      {new Date(t.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
                    </td>
                    <td className="py-1.5 px-1 text-[#fafafa]">OKB/USDC</td>
                    <td className="py-1.5 px-1 text-right text-[#a1a1aa]">
                      {(parseFloat(t.amountIn) / 1e18).toFixed(4)}
                    </td>
                    <td className="py-1.5 px-1 text-right text-[#a1a1aa]">
                      {t.amountOut ? `$${(parseFloat(t.amountOut) / 1e6).toFixed(2)}` : '--'}
                    </td>
                    <td className={`py-1.5 px-1 text-right font-medium ${profit > 0 ? 'text-[#10b981]' : profit < 0 ? 'text-[#ef4444]' : 'text-[#71717a]'}`}>
                      {profit > 0 ? '+' : ''}{profit !== 0 ? `$${profit.toFixed(2)}` : '--'}
                    </td>
                    <td className="py-1.5 px-1 text-center">
                      {t.status === 'EXECUTED' ? (
                        <span className="text-[#10b981]">{'\\u2713'}</span>
                      ) : (
                        <span className="text-[#ef4444]">{'\\u2717'}</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {t.txHash ? (
                        <a
                          href={`https://www.okx.com/web3/explorer/xlayer/tx/${t.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#10b981] hover:underline"
                        >
                          {t.txHash.slice(0, 8)}...
                        </a>
                      ) : (
                        <span className="text-[#71717a]">--</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

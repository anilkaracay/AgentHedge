import { ExternalLink } from 'lucide-react';
import type { TradeResult } from '../hooks/useSocket';

interface Props {
  trades: TradeResult[];
}

const statusIcon: Record<string, string> = {
  EXECUTED: '\u2705',
  FAILED: '\u274C',
  SKIPPED: '\u23ED\uFE0F',
};

export default function TradeHistory({ trades }: Props) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Trade History
      </h2>

      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="text-gray-600 text-sm text-center py-8">
            No trades executed yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="pb-2 text-left font-medium">Time</th>
                <th className="pb-2 text-left font-medium">Direction</th>
                <th className="pb-2 text-right font-medium">Profit</th>
                <th className="pb-2 text-center font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const profit = t.realizedProfit ?? 0;
                const profitColor = profit > 0 ? 'text-emerald-400' : profit < 0 ? 'text-red-400' : 'text-gray-400';
                return (
                  <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2.5 text-gray-300 font-mono text-xs">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">
                        ETH/USDC
                      </span>
                    </td>
                    <td className={`py-2.5 text-right font-mono font-bold ${profitColor}`}>
                      {profit > 0 ? '+' : ''}${profit.toFixed(2)}
                    </td>
                    <td className="py-2.5 text-center">
                      {statusIcon[t.status] ?? t.status}
                    </td>
                    <td className="py-2.5 text-right">
                      {t.txHash ? (
                        <a
                          href={`https://www.okx.com/web3/explorer/xlayer/tx/${t.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-400 font-mono text-xs"
                        >
                          {t.txHash.slice(0, 6)}...
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
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

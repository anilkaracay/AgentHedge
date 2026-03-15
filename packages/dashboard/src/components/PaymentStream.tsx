import { ArrowRight, Zap } from 'lucide-react';
import type { X402PaymentEvent } from '../hooks/useSocket';

interface Props {
  payments: (X402PaymentEvent & { timestamp: string })[];
}

const agentColors: Record<string, string> = {
  scout: 'text-emerald-400',
  analyst: 'text-blue-400',
  executor: 'text-orange-400',
  treasury: 'text-purple-400',
};

export default function PaymentStream({ payments }: Props) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={14} className="text-yellow-400" />
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          x402 Payment Stream
        </h2>
        <span className="ml-auto text-xs text-gray-600">{payments.length} payments</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 scrollbar-thin">
        {payments.length === 0 && (
          <div className="text-gray-600 text-sm text-center py-8">
            Waiting for x402 payments...
          </div>
        )}

        {payments.map((p, i) => (
          <div
            key={`${p.timestamp}-${i}`}
            className={`px-3 py-2 rounded-lg border text-sm ${
              i === 0
                ? 'bg-yellow-400/5 border-yellow-400/20 animate-pulse'
                : 'bg-gray-800/50 border-gray-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`font-medium ${agentColors[p.from] ?? 'text-gray-300'}`}>
                  {p.from}
                </span>
                <ArrowRight size={12} className="text-gray-600" />
                <span className={`font-medium ${agentColors[p.to] ?? 'text-gray-300'}`}>
                  {p.to}
                </span>
              </div>
              <span className="text-yellow-400 font-mono font-bold text-xs">
                {p.amount.toFixed(2)} USDC
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-gray-500 text-xs">{p.purpose}</span>
              <span className="text-gray-600 text-xs font-mono">
                {new Date(p.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {p.txHash && (
              <a
                href={`https://www.okx.com/web3/explorer/xlayer/tx/${p.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 text-xs hover:underline mt-1 block font-mono"
              >
                {p.txHash.slice(0, 10)}...{p.txHash.slice(-8)}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

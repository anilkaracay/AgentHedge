import type { X402PaymentEvent } from '../hooks/useSocket';

interface Props {
  payments: (X402PaymentEvent & { timestamp: string })[];
}

const AGENT_COLORS: Record<string, string> = {
  scout: '#10b981',
  analyst: '#3b82f6',
  executor: '#f59e0b',
  treasury: '#8b5cf6',
};

export default function PaymentStream({ payments }: Props) {
  return (
    <div className="bg-[#0a0a0a] border border-[#27272a] flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[#27272a] flex items-center justify-between">
        <span className="font-mono text-[11px] text-[#71717a] uppercase tracking-wider">x402 Payments</span>
        <span className="font-mono text-[10px] text-[#71717a]">{payments.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {payments.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#71717a] text-[12px]">
            Waiting for x402 payments...
          </div>
        ) : (
          payments.map((p, i) => (
            <div
              key={`${p.timestamp}-${i}`}
              className={`px-3 py-1.5 border-b border-[#27272a]/50 font-mono text-[11px] flex items-center gap-2 ${i === 0 ? 'animate-slide-in border-l-2 border-l-[#10b981]' : ''}`}
            >
              <span className="text-[#71717a] w-[56px] flex-shrink-0">
                {new Date(p.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
              </span>
              <span style={{ color: AGENT_COLORS[p.from] || '#a1a1aa' }} className="w-[64px] flex-shrink-0 text-right uppercase">
                {p.from}
              </span>
              <span className="text-[#71717a] flex-shrink-0">{'->'}</span>
              <span style={{ color: AGENT_COLORS[p.to] || '#a1a1aa' }} className="w-[64px] flex-shrink-0 uppercase">
                {p.to}
              </span>
              <span className="text-[#fafafa] w-[72px] flex-shrink-0 text-right">{p.amount.toFixed(2)} USDC</span>
              <span className="text-[#71717a] truncate">{p.purpose}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

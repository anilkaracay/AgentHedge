import type { X402PaymentEvent } from '../hooks/useSocket';

interface Props {
  payments: (X402PaymentEvent & { timestamp: string })[];
}

const AGENT_COLORS: Record<string, string> = {
  scout: '#67e8f9',
  analyst: '#c084fc',
  executor: '#FACC15',
  treasury: '#4ade80',
};

export default function PaymentStream({ payments }: Props) {
  return (
    <div className="card flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <span className="font-serif text-[13px] text-[#e4e4e7]">x402 Payment Stream</span>
        <span className="font-mono text-[10px] text-[#52525b]">{payments.length} total</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {payments.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-[11px] text-[#3f3f46]">Waiting for x402 payments...</span>
          </div>
        ) : (
          payments.map((p, i) => (
            <div
              key={`${p.timestamp}-${i}`}
              className={`px-3 py-1.5 border-b border-[rgba(255,255,255,0.03)] font-mono text-[11px] flex items-center gap-2 ${i === 0 ? 'animate-payment-flash' : ''}`}
            >
              <span className="text-[#3f3f46] w-[52px] flex-shrink-0">
                {new Date(p.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
              </span>
              <span
                style={{ color: AGENT_COLORS[p.from] || '#71717a' }}
                className="w-[60px] flex-shrink-0 text-right uppercase"
              >
                {p.from}
              </span>
              <span className="text-[#3f3f46] flex-shrink-0">→</span>
              <span
                style={{ color: AGENT_COLORS[p.to] || '#71717a' }}
                className="w-[60px] flex-shrink-0 uppercase"
              >
                {p.to}
              </span>
              <span className="text-[#FACC15] w-[72px] flex-shrink-0 text-right">{p.amount.toFixed(2)}</span>
              <span className="text-[#3f3f46] flex-shrink-0">USDC</span>
              <span className="text-[#3f3f46] truncate text-[10px]">{p.purpose}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

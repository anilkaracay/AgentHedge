import type { ChainAttestation } from '../hooks/useSocket';

const EXPLORER_BASE = 'https://www.okx.com/explorer/xlayer/tx/';

function shortenHash(hash: string) {
  return hash.slice(0, 6) + '...' + hash.slice(-4);
}

function decisionColor(decision: string) {
  if (decision === 'EXECUTE') return '#22c55e';
  if (decision === 'MONITOR') return '#FACC15';
  return '#3f3f46';
}

export default function ChainAttestations({ attestations, animate }: { attestations: ChainAttestation[]; animate?: boolean }) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-3 border-b border-[rgba(255,255,255,0.06)] pb-1.5">
        <span className="text-[10px] text-[#52525b] uppercase tracking-wider font-sans">
          On-Chain Attestations
        </span>
        <span className="font-mono text-[10px] text-[#52525b]">
          {attestations.length}
        </span>
      </div>

      {attestations.length === 0 ? (
        <div className="text-center py-3">
          <span className="font-mono text-[10px] text-[#3f3f46]">
            Waiting for first attestation...
          </span>
        </div>
      ) : (
        <div className="space-y-1">
          {attestations.slice(0, 8).map((att, i) => {
            const time = new Date(att.timestamp).toLocaleTimeString('en-US', { hour12: false });
            return (
              <div
                key={att.txHash}
                className={`flex items-center gap-2 font-mono text-[10px] py-0.5 ${animate && i === 0 ? 'animate-slide-in' : ''}`}
              >
                <span className="text-[#3f3f46] w-[50px] flex-shrink-0">{time}</span>
                <span className="text-[#52525b] flex-shrink-0">#{att.cycleId}</span>
                <span className="flex-shrink-0 font-medium" style={{ color: decisionColor(att.decision) }}>
                  {att.decision}
                </span>
                <span className="text-[#3f3f46] flex-shrink-0">{att.spreadBps}bps</span>
                <a
                  href={`${EXPLORER_BASE}${att.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FACC15]/50 hover:text-[#FACC15] truncate transition-colors"
                >
                  {shortenHash(att.txHash)}
                </a>
                <a
                  href={`${EXPLORER_BASE}${att.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FACC15]/50 hover:text-[#FACC15] flex-shrink-0 transition-colors"
                >
                  ↗
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

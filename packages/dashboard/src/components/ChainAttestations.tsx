import type { ChainAttestation } from '../hooks/useSocket';

const EXPLORER_BASE = 'https://www.okx.com/explorer/xlayer/tx/';

function shortenHash(hash: string) {
  return hash.slice(0, 6) + '...' + hash.slice(-4);
}

function decisionColor(decision: string) {
  if (decision === 'EXECUTE') return 'text-[#10b981]';
  if (decision === 'MONITOR') return 'text-[#f59e0b]';
  return 'text-[#71717a]';
}

export default function ChainAttestations({ attestations }: { attestations: ChainAttestation[] }) {
  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider">
          On-Chain Attestations
        </span>
        <span className="font-mono text-[10px] text-[#a1a1aa]">
          {attestations.length} total
        </span>
      </div>

      {attestations.length === 0 ? (
        <div className="text-center py-4">
          <span className="font-mono text-[10px] text-[#52525b]">
            Waiting for first attestation...
          </span>
        </div>
      ) : (
        <div className="space-y-0.5">
          {attestations.slice(0, 10).map((att) => {
            const time = new Date(att.timestamp).toLocaleTimeString('en-US', { hour12: false });
            return (
              <div
                key={att.txHash}
                className="grid font-mono text-[10px] py-0.5 border-b border-[#18181b]"
                style={{ gridTemplateColumns: '55px 55px 60px 55px 1fr 14px' }}
              >
                <span className="text-[#52525b]">{time}</span>
                <span className="text-[#a1a1aa]">Cycle #{att.cycleId}</span>
                <span className={decisionColor(att.decision)}>{att.decision}</span>
                <span className="text-[#71717a]">{att.spreadBps}bps</span>
                <a
                  href={`${EXPLORER_BASE}${att.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#3b82f6] hover:text-[#60a5fa] truncate"
                >
                  {shortenHash(att.txHash)}
                </a>
                <a
                  href={`${EXPLORER_BASE}${att.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#3b82f6] hover:text-[#60a5fa]"
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

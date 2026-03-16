import { useMemo } from 'react';
import type { DashboardEvent } from '../hooks/useSocket';

const THRESHOLD = 0.32; // professional tier profitability threshold

interface Props {
  events: DashboardEvent[];
}

export default function SpreadIndicator({ events }: Props) {
  const spreadHistory = useMemo(() => {
    const spreads: { spread: number; action: string }[] = [];
    for (const e of events) {
      if (e.type === 'signal_detected') {
        const d = e.data as any;
        spreads.push({ spread: d.spreadPercent ?? 0, action: 'MONITOR' });
      }
      if (e.type === 'analysis_complete') {
        const d = e.data as any;
        if (spreads.length > 0 && d.action) {
          spreads[spreads.length - 1].action = d.action;
        }
      }
    }
    return spreads.slice(0, 20).reverse();
  }, [events]);

  const latestSignal = useMemo(() => {
    const sig = events.find(e => e.type === 'signal_detected');
    if (!sig) return null;
    return sig.data as any;
  }, [events]);

  const latestAction = useMemo(() => {
    const rec = events.find(e => e.type === 'analysis_complete');
    if (!rec) return 'MONITOR';
    return (rec.data as any).action || 'MONITOR';
  }, [events]);

  const spread = latestSignal?.spreadPercent ?? 0;
  const buyVenue = latestSignal?.buyVenue?.venue ?? '--';
  const sellVenue = latestSignal?.sellVenue?.venue ?? '--';
  const buyPrice = latestSignal?.buyVenue?.price ?? 0;
  const sellPrice = latestSignal?.sellVenue?.price ?? 0;
  const venueCount = latestSignal?.venuesResponded ?? 0;
  const isExecute = latestAction === 'EXECUTE';

  // Sparkline bars
  const maxSpread = Math.max(...spreadHistory.map(s => s.spread), THRESHOLD * 1.2);
  const barH = 26;

  return (
    <div className={`card px-3 py-2 ${isExecute ? 'animate-spread-alert' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[#52525b] uppercase tracking-wider font-sans">Live Spread</span>
        <span className="font-mono text-[10px] text-[#52525b]">{venueCount} venues</span>
      </div>
      <div className="flex items-center gap-4">
        {/* Spread value */}
        <div className="flex items-baseline gap-2">
          <span className={`font-mono text-[20px] font-medium ${isExecute ? 'text-[#FACC15]' : 'text-[#e4e4e7]'}`}>
            {spread.toFixed(2)}%
          </span>
          <span className="font-mono text-[11px] text-[#52525b]">
            {latestSignal?.token ?? 'OKB'}
          </span>
        </div>

        {/* Venue names */}
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <span className="text-[#67e8f9]">{buyVenue}</span>
          <span className="text-[#3f3f46]">${buyPrice.toFixed(2)}</span>
          <span className="text-[#3f3f46]">→</span>
          <span className="text-[#FACC15]">{sellVenue}</span>
          <span className="text-[#3f3f46]">${sellPrice.toFixed(2)}</span>
        </div>

        {/* Bar sparkline with threshold */}
        <div className="flex-1 flex items-end justify-end gap-[3px] relative" style={{ height: barH }}>
          {/* Threshold line */}
          {spreadHistory.length > 0 && (
            <div
              className="absolute left-0 right-0"
              style={{
                bottom: (THRESHOLD / maxSpread) * barH,
                height: 1,
                borderTop: '1px dashed rgba(250,204,21,0.2)',
              }}
            />
          )}
          {spreadHistory.map((s, i) => {
            const h = Math.max(2, (s.spread / maxSpread) * barH);
            const color = s.action === 'EXECUTE' ? '#FACC15' : '#3f3f46';
            return (
              <div
                key={i}
                className="w-[4px] rounded-t-[1px] relative z-10"
                style={{ height: h, backgroundColor: color }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

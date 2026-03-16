import { useMemo } from 'react';
import type { DashboardEvent } from '../hooks/useSocket';

const THRESHOLD = 0.32;
const CHART_H = 48;
const MAX_BARS = 24;

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
    return spreads.slice(0, MAX_BARS).reverse();
  }, [events]);

  const latestSignal = useMemo(() => {
    const sig = events.find(e => e.type === 'signal_detected');
    return sig ? sig.data as any : null;
  }, [events]);

  const latestAction = useMemo(() => {
    const rec = events.find(e => e.type === 'analysis_complete');
    return rec ? (rec.data as any).action || 'MONITOR' : 'MONITOR';
  }, [events]);

  const spread = latestSignal?.spreadPercent ?? 0;
  const buyVenue = latestSignal?.buyVenue?.venue ?? '--';
  const sellVenue = latestSignal?.sellVenue?.venue ?? '--';
  const buyPrice = latestSignal?.buyVenue?.price ?? 0;
  const sellPrice = latestSignal?.sellVenue?.price ?? 0;
  const venueCount = latestSignal?.venuesResponded ?? 0;
  const isExecute = latestAction === 'EXECUTE';

  // Scale: ensure threshold is always visible around 40% height
  const maxSpread = Math.max(
    ...spreadHistory.map(s => s.spread),
    THRESHOLD * 2.5,
  );

  const thresholdPct = (THRESHOLD / maxSpread) * 100; // as % from bottom

  return (
    <div className={`card px-3 pt-2 pb-1 ${isExecute ? 'animate-spread-alert' : ''}`}>
      {/* Row 1: Info */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-baseline gap-3">
          <span className={`font-mono text-[20px] font-medium ${isExecute ? 'text-[#FACC15]' : 'text-[#e4e4e7]'}`}>
            {spread.toFixed(2)}%
          </span>
          <span className="font-mono text-[10px] text-[#52525b]">{latestSignal?.token ?? 'OKB'}</span>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="text-[#67e8f9]">{buyVenue}</span>
            <span className="text-[#3f3f46]">${buyPrice.toFixed(2)}</span>
            <span className="text-[#3f3f46]">→</span>
            <span className="text-[#FACC15]">{sellVenue}</span>
            <span className="text-[#3f3f46]">${sellPrice.toFixed(2)}</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-[#52525b]">{venueCount} venues</span>
      </div>

      {/* Row 2: Full-width bar chart */}
      <div className="relative w-full" style={{ height: CHART_H }}>
        {/* Threshold line */}
        <div
          className="absolute left-0 right-0 flex items-center"
          style={{ bottom: `${thresholdPct}%` }}
        >
          <div className="flex-1 border-t border-dashed" style={{ borderColor: 'rgba(239,68,68,0.3)' }} />
          <span className="font-mono text-[8px] ml-1.5 flex-shrink-0" style={{ color: 'rgba(239,68,68,0.5)' }}>
            {THRESHOLD}%
          </span>
        </div>

        {/* Bars */}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {spreadHistory.map((s, i) => {
            const hPct = Math.max(2, (s.spread / maxSpread) * 100);
            const isProfitable = s.spread >= THRESHOLD;
            const isLatest = i === spreadHistory.length - 1;
            return (
              <div
                key={i}
                className="flex-1 rounded-t-[1px] transition-all duration-500"
                style={{
                  height: `${hPct}%`,
                  backgroundColor: isProfitable ? '#FACC15' : '#3f3f46',
                  opacity: isProfitable ? 0.85 : 0.4,
                  minWidth: 0,
                  boxShadow: isLatest && isProfitable ? '0 0 8px rgba(250,204,21,0.3)' : 'none',
                }}
              />
            );
          })}
          {/* Pad empty slots so bars are always same width */}
          {Array.from({ length: Math.max(0, MAX_BARS - spreadHistory.length) }).map((_, i) => (
            <div key={`empty-${i}`} className="flex-1" />
          ))}
        </div>
      </div>
    </div>
  );
}

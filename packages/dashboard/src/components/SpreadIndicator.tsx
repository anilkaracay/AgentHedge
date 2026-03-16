import { useMemo } from 'react';
import type { DashboardEvent } from '../hooks/useSocket';

const THRESHOLD = 0.32;
const BAR_W = 6;
const BAR_GAP = 3;
const CHART_H = 32;
const MAX_BARS = 20;
const CHART_W = MAX_BARS * (BAR_W + BAR_GAP);

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

  // Scale: at least 0.8% so bars have room
  const maxSpread = Math.max(...spreadHistory.map(s => s.spread), THRESHOLD * 2.5, 0.8);
  const thresholdY = CHART_H - (THRESHOLD / maxSpread) * CHART_H;

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

        {/* SVG Bar Chart */}
        <div className="flex-1 flex justify-end">
          <svg width={CHART_W + 30} height={CHART_H} className="overflow-visible">
            {/* Threshold dashed line */}
            <line
              x1="0" y1={thresholdY}
              x2={CHART_W} y2={thresholdY}
              stroke="rgba(239,68,68,0.3)"
              strokeDasharray="4 3"
              strokeWidth="1"
            />
            {/* Threshold label */}
            <text
              x={CHART_W + 4} y={thresholdY + 3}
              fill="rgba(239,68,68,0.45)"
              fontSize="8"
              fontFamily="JetBrains Mono, monospace"
            >
              {THRESHOLD}%
            </text>

            {/* Bars */}
            {spreadHistory.map((s, i) => {
              const h = Math.max(1, (s.spread / maxSpread) * CHART_H);
              const isProfitable = s.spread >= THRESHOLD;
              return (
                <rect
                  key={i}
                  x={i * (BAR_W + BAR_GAP)}
                  y={CHART_H - h}
                  width={BAR_W}
                  height={h}
                  fill={isProfitable ? '#FACC15' : '#3f3f46'}
                  rx="1"
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

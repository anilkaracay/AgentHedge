import { useMemo } from 'react';
import type { DashboardEvent } from '../hooks/useSocket';

const STEPS = ['SCOUT', 'ANALYST', 'EXECUTOR', 'TREASURY'];

const STEP_EVENTS: Record<string, string[]> = {
  SCOUT: ['signal_detected'],
  ANALYST: ['analysis_complete'],
  EXECUTOR: ['trade_executed'],
  TREASURY: ['profit_distributed', 'portfolio_update'],
};

interface Props {
  events: DashboardEvent[];
}

export default function PipelineViz({ events }: Props) {
  // Derive pipeline phase from the most recent events in this cycle
  const { completed, activeIdx } = useMemo(() => {
    const recent = events.slice(0, 15);
    const done = STEPS.map(step =>
      recent.some(e => STEP_EVENTS[step]?.includes(e.type))
    );

    // Find which step is active: the first one not yet completed
    // If all are done, activeIdx = -1 (cycle complete, all green)
    let active = -1;
    for (let i = 0; i < done.length; i++) {
      if (!done[i]) { active = i; break; }
    }

    return { completed: done, activeIdx: active };
  }, [events]);

  const allDone = activeIdx === -1;

  return (
    <div className="flex items-center justify-center py-2.5">
      {STEPS.map((step, i) => {
        const done = completed[i];
        const active = i === activeIdx;
        const pending = !done && !active;

        // Line color: green if the node BEFORE this line is completed
        const lineGreen = i > 0 && completed[i - 1];

        return (
          <div key={step} className="flex items-center">
            {/* Connector line (before node, not after last) */}
            {i > 0 && (
              <div
                className="mx-2.5"
                style={{
                  width: 52,
                  height: 1,
                  background: lineGreen ? '#22c55e' : '#27272a',
                  marginBottom: 18,
                }}
              />
            )}

            {/* Node + label */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={active ? 'pipeline-active' : ''}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: active ? '#FACC15' : done ? '#22c55e' : '#3f3f46',
                  boxShadow: active ? '0 0 8px rgba(250,204,21,0.4)' : 'none',
                }}
              />
              <span
                className="font-mono text-[10px] uppercase"
                style={{
                  letterSpacing: '0.1em',
                  color: active ? '#FACC15' : done ? '#e4e4e7' : '#52525b',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {step}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import type { DashboardEvent } from '../hooks/useSocket';

const STEPS = ['SCOUT', 'ANALYST', 'EXECUTOR', 'TREASURY'];

const STAGE_EVENTS: Record<string, string[]> = {
  SCOUT: ['signal_detected'],
  ANALYST: ['analysis_complete'],
  EXECUTOR: ['trade_executed'],
  TREASURY: ['profit_distributed', 'portfolio_update'],
};

interface Props {
  events: DashboardEvent[];
}

export default function PipelineViz({ events }: Props) {
  const recent = events.slice(0, 12);

  const completed = STEPS.map(step =>
    recent.some(e => STAGE_EVENTS[step]?.includes(e.type))
  );

  // Active = first non-completed, or -1 if all done
  let activeIdx = -1;
  for (let i = 0; i < STEPS.length; i++) {
    if (!completed[i]) { activeIdx = i; break; }
  }
  // If all completed, show all green (cycle done)
  const allDone = completed.every(Boolean);

  return (
    <div className="flex items-center justify-center py-2.5">
      {STEPS.map((step, i) => {
        const done = completed[i];
        const active = i === activeIdx && !allDone;
        const pending = !done && !active;

        return (
          <div key={step} className="flex items-center">
            {/* Connector before node */}
            {i > 0 && (
              <div
                className="mx-2.5"
                style={{
                  width: 52,
                  height: 1,
                  background: completed[i - 1] ? (allDone ? '#22c55e' : '#22c55e') : '#27272a',
                  marginBottom: 18,
                }}
              />
            )}

            {/* Node */}
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

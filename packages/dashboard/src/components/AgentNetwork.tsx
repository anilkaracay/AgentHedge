import { useState, useEffect } from 'react';
import type { DashboardEvent, X402PaymentEvent } from '../hooks/useSocket';

const agents = [
  { id: 'scout', label: 'Scout', role: 'Price Scanner', color: '#34d399', x: 80, y: 100 },
  { id: 'analyst', label: 'Analyst', role: 'Profit Analysis', color: '#60a5fa', x: 260, y: 100 },
  { id: 'executor', label: 'Executor', role: 'Trade Execution', color: '#fb923c', x: 440, y: 100 },
  { id: 'treasury', label: 'Treasury', role: 'Risk & Capital', color: '#c084fc', x: 620, y: 100 },
];

const edges = [
  { from: 0, to: 1, label: '0.02 USDC' },
  { from: 1, to: 2, label: '0.03 USDC' },
  { from: 2, to: 3, label: 'profit' },
];

interface Props {
  events: DashboardEvent[];
}

export default function AgentNetwork({ events }: Props) {
  const [activeEdge, setActiveEdge] = useState<number | null>(null);
  const [agentStats, setAgentStats] = useState<Record<string, { requests: number; revenue: number }>>({
    scout: { requests: 0, revenue: 0 },
    analyst: { requests: 0, revenue: 0 },
    executor: { requests: 0, revenue: 0 },
    treasury: { requests: 0, revenue: 0 },
  });

  useEffect(() => {
    const latest = events[0];
    if (!latest) return;

    if (latest.type === 'x402_payment') {
      const payment = latest.data as X402PaymentEvent;
      const edgeIdx = edges.findIndex(
        (e) => agents[e.from].id === payment.from || agents[e.to].id === payment.to
      );
      if (edgeIdx >= 0) {
        setActiveEdge(edgeIdx);
        setTimeout(() => setActiveEdge(null), 1500);
      }

      setAgentStats((prev) => ({
        ...prev,
        [payment.to]: {
          requests: (prev[payment.to]?.requests ?? 0) + 1,
          revenue: (prev[payment.to]?.revenue ?? 0) + payment.amount,
        },
      }));
    }
  }, [events]);

  const registeredAgents = new Set(
    events
      .filter((e) => e.type === 'agent_registered')
      .map((e) => (e.data as { agentId: string }).agentId)
  );

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Agent Network
      </h2>
      <svg viewBox="0 0 720 200" className="w-full">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = agents[edge.from];
          const to = agents[edge.to];
          const isActive = activeEdge === i;
          return (
            <g key={`edge-${i}`}>
              <line
                x1={from.x + 60}
                y1={from.y}
                x2={to.x - 60}
                y2={to.y}
                stroke={isActive ? '#fbbf24' : '#374151'}
                strokeWidth={isActive ? 3 : 1.5}
                strokeDasharray={isActive ? undefined : '6 4'}
                className={isActive ? 'animate-pulse' : ''}
              />
              {isActive && (
                <text
                  x={(from.x + to.x) / 2}
                  y={from.y - 20}
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="11"
                  fontWeight="bold"
                >
                  {edge.label}
                </text>
              )}
              {/* Arrow */}
              <polygon
                points={`${to.x - 64},${to.y - 5} ${to.x - 64},${to.y + 5} ${to.x - 56},${to.y}`}
                fill={isActive ? '#fbbf24' : '#374151'}
              />
            </g>
          );
        })}

        {/* Agent Nodes */}
        {agents.map((agent) => {
          const isRegistered = registeredAgents.has(agent.id);
          const stats = agentStats[agent.id] ?? { requests: 0, revenue: 0 };
          return (
            <g key={agent.id}>
              {/* Outer ring */}
              <circle
                cx={agent.x}
                cy={agent.y}
                r={42}
                fill="none"
                stroke={agent.color}
                strokeWidth={1}
                opacity={0.3}
              />
              {/* Main circle */}
              <circle
                cx={agent.x}
                cy={agent.y}
                r={36}
                fill="#111827"
                stroke={agent.color}
                strokeWidth={2}
                filter={isRegistered ? 'url(#glow)' : undefined}
              />
              {/* Status dot */}
              <circle
                cx={agent.x + 26}
                cy={agent.y - 26}
                r={5}
                fill={isRegistered ? '#22c55e' : '#6b7280'}
              />
              {/* Agent label */}
              <text
                x={agent.x}
                y={agent.y - 6}
                textAnchor="middle"
                fill={agent.color}
                fontSize="13"
                fontWeight="bold"
              >
                {agent.label}
              </text>
              {/* Role */}
              <text
                x={agent.x}
                y={agent.y + 10}
                textAnchor="middle"
                fill="#9ca3af"
                fontSize="8"
              >
                {agent.role}
              </text>
              {/* Stats below node */}
              <text
                x={agent.x}
                y={agent.y + 58}
                textAnchor="middle"
                fill="#6b7280"
                fontSize="9"
              >
                {stats.requests} reqs • ${stats.revenue.toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

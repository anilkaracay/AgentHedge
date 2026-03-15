# Dashboard Specification

## Overview

React SPA that connects to the orchestrator via WebSocket (Socket.io) and displays real-time agent activity, x402 payments, trades, and portfolio status.

## Tech Stack

- React 18 + TypeScript
- TailwindCSS (utility classes only)
- Recharts (charts)
- Socket.io-client (WebSocket)
- React Flow or simple SVG (agent network visualization)

## Layout

```
┌─────────────────────────────────────────────────────────┐
│  AgentHedge Dashboard                    [Status: Live]  │
├───────────────────────┬─────────────────────────────────┤
│   Agent Network       │   Payment Stream                │
│   (4 nodes + edges)   │   (scrolling feed)              │
│                       │                                 │
├───────────────────────┼─────────────────────────────────┤
│   Trade History       │   Risk Dashboard                │
│   (table with tx      │   (portfolio value, P&L chart,  │
│    links)             │    circuit breaker status)       │
└───────────────────────┴─────────────────────────────────┘
```

## Components

### 1. AgentNetwork (`components/AgentNetwork.tsx`)

Visual graph showing 4 agent nodes arranged in a pipeline with animated edges representing x402 payments.

**Nodes**: Scout (green), Analyst (blue), Executor (orange), Treasury (purple)
Each node shows: agent name, role, status (active/idle), request count, revenue earned

**Edges**: Animate when x402 payment occurs between agents. Show payment amount on the edge briefly.

Implementation: Simple SVG with positioned circles and lines. Animate edges with CSS transitions when payment events arrive.

### 2. PaymentStream (`components/PaymentStream.tsx`)

Scrolling live feed of x402 payments between agents.

Each entry shows:
- Timestamp
- From agent → To agent
- Amount (e.g., "0.02 USDC")
- Purpose (e.g., "Signal purchase")
- X Layer tx hash (linked to explorer: `https://www.okx.com/web3/explorer/xlayer/tx/{hash}`)

Newest entries at top. Keep last 50 entries visible.

### 3. TradeHistory (`components/TradeHistory.tsx`)

Table of executed trades:

| Time | Pair | Direction | Amount In | Amount Out | Profit | Status | Tx Hash |
|---|---|---|---|---|---|---|---|
| 12:34:05 | ETH/USDC | BUY_DEX | 0.5 ETH | 1,225 USDC | +$2.30 | ✅ | [0xabc...] |

Tx Hash links to X Layer explorer. Color-code profit (green) and loss (red).

### 4. RiskDashboard (`components/RiskDashboard.tsx`)

- **Portfolio Value**: Large number display (e.g., "$1,234.56")
- **Daily P&L**: Number + percentage, color-coded (green/red)
- **P&L Chart**: Recharts line chart showing cumulative P&L over time
- **Token Allocation**: Recharts pie chart showing portfolio composition
- **Circuit Breaker**: Status indicator (green = normal, red = active)
- **Daily Loss Used**: Progress bar showing how much of daily loss limit is consumed

## WebSocket Integration

### Server (in orchestrator)

```typescript
// orchestrator/src/index.ts
import { Server } from 'socket.io';
import { createServer } from 'http';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:3000' }
});

// Forward all eventBus events to connected dashboards
eventBus.on('*', (event: DashboardEvent) => {
  io.emit('dashboard_event', event);
});

httpServer.listen(3005);
```

### Client (in dashboard)

```typescript
// dashboard/src/hooks/useSocket.ts
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useDashboardEvents() {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);

  useEffect(() => {
    const socket = io('http://localhost:3005');

    socket.on('dashboard_event', (event: DashboardEvent) => {
      setEvents(prev => [event, ...prev].slice(0, 100));

      if (event.type === 'portfolio_update') {
        setPortfolio(event.data);
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  return { events, portfolio };
}
```

## Event Types

| Event | Emitted By | Data |
|---|---|---|
| `agent_registered` | Each agent on startup | `{ agentId, role, endpoint }` |
| `signal_detected` | Scout | `OpportunitySignal` |
| `x402_payment` | Any agent making/receiving payment | `X402PaymentEvent` |
| `analysis_complete` | Analyst | `ExecutionRecommendation` |
| `trade_executed` | Executor | `TradeResult` |
| `profit_distributed` | Treasury | `ProfitDistribution` |
| `risk_alert` | Treasury | `{ type, message }` |
| `portfolio_update` | Treasury | `PortfolioSnapshot` |
| `cycle_complete` | Orchestrator | `{ cycleId, duration, result }` |

## Styling

Use TailwindCSS with a dark theme:
- Background: `bg-gray-950`
- Cards: `bg-gray-900 border border-gray-800 rounded-lg`
- Text: `text-gray-100` (primary), `text-gray-400` (secondary)
- Accent: `text-emerald-400` (profit/success), `text-red-400` (loss/error)
- Agent colors: Scout `emerald`, Analyst `blue`, Executor `orange`, Treasury `purple`

## Build & Serve

```bash
cd packages/dashboard
npm create vite@latest . -- --template react-ts
npm install tailwindcss @tailwindcss/vite recharts socket.io-client
```

Keep it simple — this is a demo dashboard, not a production app. Prioritize visual impact over code elegance.

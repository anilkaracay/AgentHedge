import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface DashboardEvent {
  type: 'agent_registered' | 'signal_detected' | 'analysis_complete'
    | 'trade_executed' | 'profit_distributed' | 'risk_alert'
    | 'x402_payment' | 'cycle_complete' | 'portfolio_update'
    | 'chain_attestation';
  data: any;
  timestamp: string;
}

export interface ChainAttestation {
  cycleId: number;
  txHash: string;
  spreadBps: number;
  decision: string;
  timestamp: string;
}

export interface PortfolioSnapshot {
  totalValueUSD: number;
  tokenBalances: { token: string; balance: string; valueUSD: number }[];
  dailyPnL: number;
  dailyPnLPercent: number;
  circuitBreakerActive: boolean;
}

export interface X402PaymentEvent {
  from: string;
  to: string;
  amount: number;
  txHash?: string;
  purpose: string;
}

export interface TradeResult {
  id: string;
  recommendationId: string;
  status: 'EXECUTED' | 'FAILED' | 'SKIPPED';
  txHash?: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut?: string;
  realizedProfit?: number;
  gasUsed?: string;
  blockNumber?: number;
  error?: string;
  timestamp: string;
}

const API_HOST = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? `${window.location.protocol}//${window.location.host}`
  : 'http://localhost:4005';

export function useDashboardEvents() {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [payments, setPayments] = useState<(X402PaymentEvent & { timestamp: string })[]>([]);
  const [trades, setTrades] = useState<TradeResult[]>([]);
  const [connected, setConnected] = useState(false);
  const [pnlHistory, setPnlHistory] = useState<{ time: string; pnl: number }[]>([]);
  const [attestations, setAttestations] = useState<ChainAttestation[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(API_HOST, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('dashboard_event', (event: DashboardEvent) => {
      setEvents(prev => [event, ...prev].slice(0, 100));

      switch (event.type) {
        case 'portfolio_update':
          setPortfolio(event.data as PortfolioSnapshot);
          setPnlHistory(prev => [
            ...prev,
            {
              time: new Date(event.timestamp).toLocaleTimeString(),
              pnl: (event.data as PortfolioSnapshot).dailyPnL,
            },
          ].slice(-30));
          break;
        case 'x402_payment':
          setPayments(prev => [
            { ...(event.data as X402PaymentEvent), timestamp: event.timestamp },
            ...prev,
          ].slice(0, 50));
          break;
        case 'trade_executed':
          setTrades(prev => [event.data as TradeResult, ...prev].slice(0, 50));
          break;
        case 'chain_attestation':
          setAttestations(prev => [event.data as ChainAttestation, ...prev].slice(0, 50));
          break;
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  const [demoMode, setDemoMode] = useState(false);

  // Fetch initial demo mode state
  useEffect(() => {
    fetch(`${API_HOST}/api/demo-mode`).then(r => r.json()).then((d: any) => setDemoMode(d.demoMode)).catch(() => {});
  }, []);

  const toggleDemoMode = () => {
    const newMode = !demoMode;
    fetch(`${API_HOST}/api/demo-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demoMode: newMode }),
    }).then(() => setDemoMode(newMode)).catch(() => {});
  };

  return { events, portfolio, payments, trades, connected, pnlHistory, attestations, demoMode, toggleDemoMode };
}

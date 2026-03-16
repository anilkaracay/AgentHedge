import TelegramBot from 'node-telegram-bot-api';
import { logInfo, logError } from './logger.js';

// ── Types ──

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  throttleMonitor: number;   // send every Nth monitor cycle
  spreadThreshold: number;   // alert when spread > this %
}

export interface SystemStateAccessor {
  getRecentTrades: (n: number) => any[];
  getPortfolio: () => { totalValueUSD: number; dailyPnL: number };
  getCycleCount: () => number;
  getUptime: () => number;
  getAttestationCount: () => number;
  isPaused: () => boolean;
  pause: () => void;
  resume: () => void;
  getDemoMode: () => boolean;
}

// ── Formatting Helpers ──

function fmtUSD(n: number): string {
  return n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function shortenHash(hash: string): string {
  return hash.slice(0, 6) + '...' + hash.slice(-4);
}

const EXPLORER_TX = 'https://www.okx.com/explorer/xlayer/tx/';

// ── Bot Class ──

export class AgentHedgeTelegramBot {
  private bot: TelegramBot | null = null;
  private chatId: string;
  private enabled: boolean;
  private monitorCount = 0;
  private throttleMonitor: number;
  private spreadThreshold: number;
  private state: SystemStateAccessor | null = null;
  private lastSpreadAlertTime = 0;

  constructor(config: TelegramConfig) {
    this.chatId = config.chatId;
    this.enabled = config.enabled;
    this.throttleMonitor = config.throttleMonitor;
    this.spreadThreshold = config.spreadThreshold;

    if (this.enabled && config.botToken) {
      try {
        this.bot = new TelegramBot(config.botToken, { polling: true });
        this.registerCommands();
        logInfo('telegram', 'Bot initialized and polling');
      } catch (err) {
        logError('telegram', 'Failed to initialize bot', err);
        this.enabled = false;
      }
    } else {
      logInfo('telegram', 'Bot disabled (TELEGRAM_ENABLED !== true)');
    }
  }

  setStateAccessor(state: SystemStateAccessor) {
    this.state = state;
  }

  // ── Command Handlers ──

  private registerCommands() {
    if (!this.bot) return;

    this.bot.onText(/\/start/, (msg) => {
      if (String(msg.chat.id) !== this.chatId) return;
      this.sendMessage(
        '🤖 *AgentHedge Bot*\n\n' +
        'Autonomous CeDeFi arbitrage system on X Layer.\n' +
        'Use /help to see available commands.'
      );
    });

    this.bot.onText(/\/help/, (msg) => {
      if (String(msg.chat.id) !== this.chatId) return;
      this.sendMessage(
        '🤖 *AgentHedge Commands*\n\n' +
        '/status — System status & agent info\n' +
        '/trades — Last 5 trades\n' +
        '/pnl — P\\&L summary\n' +
        '/pause — Pause trading\n' +
        '/resume — Resume trading\n' +
        '/help — Show this message'
      );
    });

    this.bot.onText(/\/status/, (msg) => {
      if (String(msg.chat.id) !== this.chatId) return;
      this.handleStatusCommand();
    });

    this.bot.onText(/\/trades/, (msg) => {
      if (String(msg.chat.id) !== this.chatId) return;
      this.handleTradesCommand();
    });

    this.bot.onText(/\/pnl/, (msg) => {
      if (String(msg.chat.id) !== this.chatId) return;
      this.handlePnlCommand();
    });

    this.bot.onText(/\/pause/, (msg) => {
      if (String(msg.chat.id) !== this.chatId) return;
      this.handlePauseCommand();
    });

    this.bot.onText(/\/resume/, (msg) => {
      if (String(msg.chat.id) !== this.chatId) return;
      this.handleResumeCommand();
    });
  }

  private handleStatusCommand() {
    if (!this.state) { this.sendMessage('System state not available yet.'); return; }

    const portfolio = this.state.getPortfolio();
    const cycles = this.state.getCycleCount();
    const uptime = fmtUptime(this.state.getUptime());
    const mode = this.state.getDemoMode() ? 'DEMO ($800K simulated)' : 'LIVE';
    const paused = this.state.isPaused() ? '⏸ PAUSED' : '▶ RUNNING';
    const trades = this.state.getRecentTrades(1000);
    const attestations = this.state.getAttestationCount();
    const winRate = trades.length > 0
      ? Math.round((trades.filter((t: any) => t.netProfit > 0).length / trades.length) * 100)
      : 0;

    this.sendMessage(
      `🤖 *AgentHedge Status*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Uptime: ${uptime}\n` +
      `Mode: ${mode}\n` +
      `Cycle: #${cycles}\n` +
      `State: ${paused}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `SCOUT     ● ACTIVE\n` +
      `ANALYST   ● ACTIVE\n` +
      `EXECUTOR  ● ACTIVE\n` +
      `TREASURY  ● ACTIVE\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💼 Portfolio: $${portfolio.totalValueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `📈 Session P\\&L: ${fmtUSD(portfolio.dailyPnL)}\n` +
      `📊 Trades: ${trades.length} | Win rate: ${winRate}%\n` +
      `⛓ Attestations: ${attestations}`
    );
  }

  private handleTradesCommand() {
    if (!this.state) { this.sendMessage('System state not available yet.'); return; }

    const trades = this.state.getRecentTrades(5);
    if (trades.length === 0) {
      this.sendMessage('No trades executed yet.');
      return;
    }

    let text = `📋 *Last ${trades.length} Trades*\n━━━━━━━━━━━━━━━━━━\n`;
    for (const t of trades.reverse()) {
      const time = new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false });
      text += `${time} | ${t.buyVenue?.venue || '?'} → ${t.sellVenue?.venue || '?'}\n`;
      text += `  Size: $${(t.sizeUSD || 0).toLocaleString()} | P\\&L: ${fmtUSD(t.netProfit || 0)}\n`;
    }
    this.sendMessage(text);
  }

  private handlePnlCommand() {
    if (!this.state) { this.sendMessage('System state not available yet.'); return; }

    const trades = this.state.getRecentTrades(10000);
    const portfolio = this.state.getPortfolio();
    const profitable = trades.filter((t: any) => (t.netProfit || 0) > 0);
    const totalPnl = trades.reduce((sum: number, t: any) => sum + (t.netProfit || 0), 0);
    const bestTrade = trades.reduce((best: any, t: any) => (t.netProfit || 0) > (best?.netProfit || 0) ? t : best, trades[0]);
    const avgProfit = trades.length > 0 ? totalPnl / trades.length : 0;

    // Venue frequency
    const sellVenues: Record<string, number> = {};
    const buyVenues: Record<string, number> = {};
    for (const t of trades) {
      const sv = t.sellVenue?.venue || 'unknown';
      const bv = t.buyVenue?.venue || 'unknown';
      sellVenues[sv] = (sellVenues[sv] || 0) + 1;
      buyVenues[bv] = (buyVenues[bv] || 0) + 1;
    }
    const topSell = Object.entries(sellVenues).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topBuy = Object.entries(buyVenues).sort((a, b) => b[1] - a[1]).slice(0, 3);

    let text = `📊 *P\\&L Summary*\n━━━━━━━━━━━━━━━━━━\n`;
    text += `Session trades: ${trades.length}\n`;
    text += `Profitable: ${profitable.length} (${trades.length > 0 ? Math.round(profitable.length / trades.length * 100) : 0}%)\n`;
    text += `Total P\\&L: ${fmtUSD(totalPnl)}\n`;
    if (bestTrade) {
      text += `Best trade: ${fmtUSD(bestTrade.netProfit || 0)} (${bestTrade.buyVenue?.venue || '?'}→${bestTrade.sellVenue?.venue || '?'})\n`;
    }
    text += `Avg profit: ${fmtUSD(avgProfit)}/trade\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `Top sell venues:\n`;
    const medals = ['🥇', '🥈', '🥉'];
    topSell.forEach(([v, c], i) => { text += `${medals[i] || '  '} ${v} — ${c} trades\n`; });
    text += `Top buy venues:\n`;
    topBuy.forEach(([v, c], i) => { text += `${medals[i] || '  '} ${v} — ${c} trades\n`; });

    this.sendMessage(text);
  }

  private handlePauseCommand() {
    if (!this.state) { this.sendMessage('System state not available yet.'); return; }
    if (this.state.isPaused()) {
      this.sendMessage('⏸ Already paused.');
      return;
    }
    this.state.pause();
    this.sendMessage('⏸ *Trading paused.* Use /resume to continue.');
  }

  private handleResumeCommand() {
    if (!this.state) { this.sendMessage('System state not available yet.'); return; }
    if (!this.state.isPaused()) {
      this.sendMessage('▶ Already running.');
      return;
    }
    this.state.resume();
    this.sendMessage('▶ *Trading resumed.* Pipeline active.');
  }

  // ── Alert Methods (called by eventBus listeners) ──

  sendTradeAlert(data: any) {
    if (!this.enabled) return;

    const buyVenue = data.buyVenue?.venue || '?';
    const sellVenue = data.sellVenue?.venue || '?';
    const buyPrice = fmtPrice(data.buyVenue?.price || 0);
    const sellPrice = fmtPrice(data.sellVenue?.price || 0);
    const sizeUSD = (data.sizeUSD || 0).toLocaleString();
    const sizeToken = (data.size || 0).toFixed(1);
    const spread = (data.spreadPercent || 0).toFixed(2);
    const netPnl = fmtUSD(data.netProfit || 0);
    const token = data.token || 'OKB';

    // Session totals
    const allTrades = this.state?.getRecentTrades(10000) || [];
    const sessionPnl = allTrades.reduce((s: number, t: any) => s + (t.netProfit || 0), 0);

    this.sendMessage(
      `🟢 *Trade Executed*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Buy: ${buyVenue} @ ${buyPrice}\n` +
      `Sell: ${sellVenue} @ ${sellPrice}\n` +
      `Size: $${sizeUSD} (${sizeToken} ${token})\n` +
      `Spread: ${spread}%\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 Net P\\&L: ${netPnl}\n` +
      `📊 Fees: $${(data.totalCosts || 0).toFixed(2)}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📈 Session: ${allTrades.length} trades | ${fmtUSD(sessionPnl)} total`
    );
  }

  sendAttestationAlert(data: any) {
    if (!this.enabled) return;

    const txHash = data.txHash || '';
    const explorerUrl = `${EXPLORER_TX}${txHash}`;

    this.sendMessage(
      `⛓ *On-Chain Attestation*\n` +
      `Cycle #${data.cycleId} | ${data.decision} | ${data.spreadBps} bps\n` +
      `TX: [${shortenHash(txHash)}](${explorerUrl})`
    );
  }

  sendMonitorUpdate(data: any) {
    if (!this.enabled) return;

    this.monitorCount++;
    if (this.monitorCount % this.throttleMonitor !== 0) return;

    const spread = (data.spreadPercent || 0).toFixed(2);
    const buyVenue = data.buyVenue || '?';
    const sellVenue = data.sellVenue || '?';
    const buyPrice = fmtPrice(data.buyPrice || 0);
    const sellPrice = fmtPrice(data.sellPrice || 0);
    const cycleId = this.state?.getCycleCount() || 0;

    this.sendMessage(
      `👁 *Market Scan #${cycleId}*\n` +
      `Spread: ${spread}% (below threshold)\n` +
      `Best: ${buyVenue} ${buyPrice} → ${sellVenue} ${sellPrice}\n` +
      `Status: MONITORING\n` +
      `Next scan in ~15s`
    );
  }

  sendSpreadAlert(data: any) {
    if (!this.enabled) return;

    // Throttle: max one spread alert per 60 seconds
    const now = Date.now();
    if (now - this.lastSpreadAlertTime < 60_000) return;
    this.lastSpreadAlertTime = now;

    if ((data.spreadPercent || 0) < this.spreadThreshold) return;

    const buyVenue = data.buyVenue?.venue || '?';
    const sellVenue = data.sellVenue?.venue || '?';
    const buyPrice = fmtPrice(data.buyVenue?.price || 0);
    const sellPrice = fmtPrice(data.sellVenue?.price || 0);
    const spread = (data.spreadPercent || 0).toFixed(2);

    this.sendMessage(
      `🚨 *Spread Alert\\!*\n` +
      `${data.token || 'OKB'} spread widened to ${spread}%\n` +
      `${buyVenue}: ${buyPrice} → ${sellVenue}: ${sellPrice}\n` +
      `⚡ Executing...`
    );
  }

  sendStartupMessage(mode: string, feeTier: string) {
    if (!this.enabled) return;

    this.sendMessage(
      `🚀 *AgentHedge Started*\n` +
      `Mode: ${mode}\n` +
      `Fee tier: ${feeTier}\n` +
      `Venues: 8 (7 CEX + 1 DEX)\n` +
      `Awaiting first scan...`
    );
  }

  sendShutdownMessage() {
    if (!this.enabled) return;

    const trades = this.state?.getRecentTrades(10000) || [];
    const totalPnl = trades.reduce((s: number, t: any) => s + (t.netProfit || 0), 0);
    const uptime = this.state ? fmtUptime(this.state.getUptime()) : '??:??:??';

    this.sendMessage(
      `🛑 *AgentHedge Shutting Down*\n` +
      `Uptime: ${uptime}\n` +
      `Trades: ${trades.length}\n` +
      `Session P\\&L: ${fmtUSD(totalPnl)}`
    );
  }

  async sendMessage(text: string) {
    if (!this.bot || !this.enabled) return;
    try {
      await this.bot.sendMessage(this.chatId, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (err) {
      logError('telegram', `Send failed: ${(err as Error).message}`);
    }
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
    }
  }
}

function formatLog(level: string, agent: string, message: string, extra?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    agent,
    message,
  };
  if (extra) {
    Object.assign(entry, extra);
  }
  return JSON.stringify(entry);
}

export function logInfo(agent: string, message: string, data?: unknown): void {
  const extra = data !== undefined ? { data } : undefined;
  console.log(formatLog('INFO', agent, message, extra));
}

export function logError(agent: string, message: string, error?: unknown): void {
  const extra: Record<string, unknown> = {};
  if (error instanceof Error) {
    extra.error = { message: error.message, stack: error.stack };
  } else if (error !== undefined) {
    extra.error = error;
  }
  console.error(formatLog('ERROR', agent, message, Object.keys(extra).length ? extra : undefined));
}

export function logPayment(from: string, to: string, amount: number, purpose: string): void {
  console.log(formatLog('PAYMENT', from, `Paid ${amount} USDC to ${to}`, { to, amount, purpose }));
}

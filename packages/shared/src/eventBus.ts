import { EventEmitter } from 'node:events';
import type { DashboardEvent } from './types.js';

class DashboardEventBus extends EventEmitter {
  emitDashboardEvent(event: DashboardEvent): void {
    this.emit('dashboard_event', event);
  }
}

export const eventBus = new DashboardEventBus();

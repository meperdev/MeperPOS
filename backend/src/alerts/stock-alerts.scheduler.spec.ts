import type { StockAlertsService } from './stock-alerts.service';
import { StockAlertsScheduler } from './stock-alerts.scheduler';

const summary = { opened: 1, resolved: 0, notified: 1, failed: 0 };

const service = (over: Partial<StockAlertsService> = {}) =>
  ({
    scanAll: jest.fn().mockResolvedValue(summary),
    ...over,
  }) as unknown as StockAlertsService;

describe('StockAlertsScheduler', () => {
  const original = process.env.STOCK_ALERTS_ENABLED;

  beforeEach(() => {
    delete process.env.STOCK_ALERTS_ENABLED;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.STOCK_ALERTS_ENABLED;
    else process.env.STOCK_ALERTS_ENABLED = original;
  });

  it('scans on bootstrap by default', async () => {
    const alerts = service();
    const scheduler = new StockAlertsScheduler(alerts);

    await scheduler.onApplicationBootstrap();

    expect(alerts.scanAll).toHaveBeenCalledTimes(1);
  });

  it('does not block startup while the scan is still running', async () => {
    let release!: () => void;
    const gate = new Promise<typeof summary>((resolve) => {
      release = () => resolve(summary);
    });
    const alerts = {
      scanAll: jest.fn(() => gate),
    } as unknown as StockAlertsService;
    const scheduler = new StockAlertsScheduler(alerts);

    await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(alerts.scanAll).toHaveBeenCalledTimes(1);

    release();
  });

  it('does nothing when the feature is disabled', async () => {
    process.env.STOCK_ALERTS_ENABLED = 'false';
    const alerts = service();
    const scheduler = new StockAlertsScheduler(alerts);

    await scheduler.onApplicationBootstrap();
    await scheduler.handleScan();

    expect(alerts.scanAll).not.toHaveBeenCalled();
  });

  it('never throws when the scan fails', async () => {
    const alerts = service({
      scanAll: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as Partial<StockAlertsService>);
    const scheduler = new StockAlertsScheduler(alerts);

    await expect(scheduler.handleScan()).resolves.toBeUndefined();
  });
});

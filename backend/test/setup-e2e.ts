/**
 * End-to-end suites boot the whole application, which starts the low-stock scan.
 * A test run must never reach a real WhatsApp provider, so the scan is off unless
 * the caller names a value explicitly.
 */
if (process.env.STOCK_ALERTS_ENABLED === undefined) {
  process.env.STOCK_ALERTS_ENABLED = 'false';
}

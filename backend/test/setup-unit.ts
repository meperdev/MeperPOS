/**
 * Unit and integration suites boot services and, in a few cases, the whole
 * application. The low-stock scan must never run there: it walks every tenant and
 * calls the WhatsApp provider, so a test run would add outbound I/O and database
 * load no assertion asked for. End-to-end suites have their own setup file with
 * the same switch.
 */
if (process.env.STOCK_ALERTS_ENABLED === undefined) {
  process.env.STOCK_ALERTS_ENABLED = 'false';
}

// Scheduled task entry point, run INSIDE the app container by Coolify every minute:
//
//   node cron-tick.mjs
//
// It calls the app's own maintenance endpoint (hold expiry and payment
// reconciliation, email outbox retries, document retention) and authenticates
// with CRON_SECRET, which the container already has as an environment variable.
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET is not set');
  process.exit(1);
}
const port = process.env.PORT || '3000';
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/cron/tick`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(50_000),
  });
  console.log(`tick ${response.status} ${await response.text()}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error('tick failed', error instanceof Error ? error.message : 'error');
  process.exit(1);
}

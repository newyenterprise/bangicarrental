import 'server-only';

/**
 * All configuration is read at runtime on the server. Nothing here is baked
 * into the client bundle, so the Docker image needs no build-time secrets.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const env = {
  get appUrl() {
    return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  },
  get supabaseUrl() {
    return required('SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return required('SUPABASE_ANON_KEY');
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get stripeSecretKey() {
    return process.env.STRIPE_SECRET_KEY || '';
  },
  get stripeWebhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET || '';
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY || '';
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || '';
  },
  get adminAlertEmail() {
    return process.env.ADMIN_ALERT_EMAIL || '';
  },
  get cronSecret() {
    return process.env.CRON_SECRET || '';
  },
};

export type PaymentMode = 'unconfigured' | 'test' | 'live';

export function paymentMode(): PaymentMode {
  const key = env.stripeSecretKey;
  if (!key) return 'unconfigured';
  return key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test';
}

import Link from 'next/link';
import { AdminForm } from '@/components/admin/AdminForm';
import { PageTitle, Row, Section } from '@/components/admin/ui';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';
import { getLaunchStatus, getSettings } from '@/lib/settings';
import { createServiceClient } from '@/lib/supabase/server';
import { saveSettingsAction, setLivePaymentsAction } from './actions';

export default async function AdminSettingsPage() {
  await requireAdmin('/admin/settings');
  const L = pick(await getLocale());
  const [settings, launch, failed, pending] = await Promise.all([
    getSettings(),
    getLaunchStatus(),
    createServiceClient().from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    createServiceClient().from('email_outbox').select('id', { count: 'exact', head: true }).in('status', ['pending', 'sending']),
  ]);

  // Presence only. Secret values are never read into the page.
  const has = (name: string) => !!process.env[name];
  const yes = <span className="tag tag-live">{L('Dipasang', 'Set')}</span>;
  const no = <span className="tag tag-danger">{L('Tiada', 'Missing')}</span>;
  const mode = launch.paymentMode;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title={L('Tetapan', 'Settings')} />

      <Section id="checklist" title={L('Senarai semak pelancaran', 'Launch checklist')} aside={<span className={launch.complete ? 'tag tag-live' : 'tag tag-warn'}>{launch.items.filter((i) => i.done).length}/{launch.items.length}</span>}>
        <ul>
          {launch.items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="flex min-h-11 items-center gap-3 border-b border-line-soft py-2">
                <span className={item.done ? 'tag tag-live' : 'tag tag-warn'} aria-hidden>{item.done ? '✓' : '•'}</span>
                <span className={item.done ? 'text-muted' : 'font-semibold'}>{L(item.ms, item.en)}</span>
                <span className="sr-only">{item.done ? L('selesai', 'done') : L('belum', 'to do')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="live" title={L('Bayaran sebenar', 'Live payments')} aside={<span className={settings.live_payments_enabled ? 'tag tag-live' : 'tag'}>{settings.live_payments_enabled ? L('Dihidupkan', 'Enabled') : L('Dimatikan', 'Disabled')}</span>}>
        <p className="text-sm leading-relaxed">
          {mode === 'test'
            ? L('Kunci Stripe ujian dipasang: laman boleh ditempah dengan bayaran simulasi untuk latihan. Tiada wang sebenar bergerak.', 'Test Stripe keys are installed: the site can be booked with simulated payments for rehearsal. No real money moves.')
            : mode === 'live'
              ? L('Kunci Stripe live dipasang. Tempahan awam hanya dibuka apabila senarai semak lengkap DAN suis ini dihidupkan.', 'Live Stripe keys are installed. Public bookings only open when the checklist is complete AND this switch is on.')
              : L('Kunci Stripe belum dipasang. Tempahan awam ditutup.', 'Stripe keys are not installed. Public bookings are closed.')}
        </p>
        <div className="mt-3">
          {settings.live_payments_enabled ? (
            <AdminForm
              action={setLivePaymentsAction}
              hidden={{ enable: 'false', form_id: 'live-off-' }}
              fields={[]}
              danger
              submitLabel={L('Matikan bayaran sebenar', 'Disable live payments')}
              confirm={L('Matikan bayaran sebenar? Pelanggan tidak boleh menempah dalam mod live sehingga dihidupkan semula.', 'Disable live payments? Customers cannot book in live mode until it is enabled again.')}
            />
          ) : (
            <AdminForm
              action={setLivePaymentsAction}
              hidden={{ enable: 'true', form_id: 'live-on-' }}
              fields={[]}
              submitLabel={L('Hidupkan bayaran sebenar', 'Enable live payments')}
              confirm={L('Hidupkan bayaran sebenar? Pelanggan akan dicaj wang sebenar. Pastikan kadar, deposit, arahan ambil, terma pembatalan dan perjanjian adalah muktamad.', 'Enable live payments? Customers will be charged real money. Make sure the rates, deposit, pickup instructions, cancellation terms and agreement are final.')}
            />
          )}
        </div>
      </Section>

      <Section id="business" title={L('Tetapan perniagaan', 'Business settings')}>
        <AdminForm
          action={saveSettingsAction}
          hidden={{ form_id: 'settings-' }}
          submitLabel={L('Simpan tetapan', 'Save settings')}
          fields={[
            { name: 'company_name', label: L('Nama syarikat berdaftar', 'Registered company name'), defaultValue: settings.company_name, hint: L('Digunakan dalam perjanjian.', 'Used in the agreement.') },
            { name: 'display_name', label: L('Nama paparan', 'Display name'), required: true, defaultValue: settings.display_name },
            { name: 'contact_phone', label: L('Telefon untuk pelanggan', 'Customer contact phone'), type: 'tel', inputMode: 'tel', defaultValue: settings.contact_phone },
            { name: 'contact_email', label: L('Emel untuk pelanggan', 'Customer contact email'), type: 'email', inputMode: 'email', defaultValue: settings.contact_email },
            { name: 'pickup_area', label: L('Kawasan ambil (dipaparkan kepada umum)', 'Pickup area (shown publicly)'), required: true, defaultValue: settings.pickup_area },
            { name: 'pickup_instructions_ms', label: L('Arahan ambil kereta (BM) — peribadi', 'Pickup instructions (BM) — private'), type: 'textarea', rows: 4, defaultValue: settings.pickup_instructions_ms, hint: L('Alamat penuh dan arahan. Hanya dipaparkan kepada penyewa yang sedia untuk ambil kereta.', 'Full address and directions. Only shown to renters who are ready for pickup.') },
            { name: 'pickup_instructions_en', label: L('Arahan ambil kereta (English) — peribadi', 'Pickup instructions (English) — private'), type: 'textarea', rows: 4, defaultValue: settings.pickup_instructions_en },
            { name: 'operating_hours_ms', label: L('Waktu operasi (BM)', 'Operating hours (BM)'), type: 'textarea', rows: 2, defaultValue: settings.operating_hours_ms },
            { name: 'operating_hours_en', label: L('Waktu operasi (English)', 'Operating hours (English)'), type: 'textarea', rows: 2, defaultValue: settings.operating_hours_en },
            { name: 'cancellation_terms_ms', label: L('Terma pembatalan (BM)', 'Cancellation terms (BM)'), type: 'textarea', rows: 5, defaultValue: settings.cancellation_terms_ms, hint: L('Dipaparkan sebelum bayaran dan dimasukkan ke dalam perjanjian. Nyatakan tarikh akhir dan jumlah bayaran balik dengan tepat.', 'Shown before payment and included in the agreement. State deadlines and refund amounts precisely.') },
            { name: 'cancellation_terms_en', label: L('Terma pembatalan (English)', 'Cancellation terms (English)'), type: 'textarea', rows: 5, defaultValue: settings.cancellation_terms_en },
            { name: 'lead_time_hours', label: L('Notis minimum sebelum ambil (jam)', 'Minimum notice before pickup (hours)'), type: 'number', required: true, min: 0, max: 720, inputMode: 'numeric', defaultValue: String(settings.lead_time_hours) },
            { name: 'verification_deadline_hours', label: L('Tarikh akhir pengesahan (jam sebelum ambil)', 'Verification deadline (hours before pickup)'), type: 'number', required: true, min: 0, max: 720, inputMode: 'numeric', defaultValue: String(settings.verification_deadline_hours) },
            { name: 'hold_minutes', label: L('Tempoh tahanan semasa bayaran (minit, 30–120)', 'Checkout hold (minutes, 30–120)'), type: 'number', required: true, min: 30, max: 120, inputMode: 'numeric', defaultValue: String(settings.hold_minutes) },
            { name: 'max_rental_days', label: L('Tempoh sewa maksimum (hari)', 'Maximum rental length (days)'), type: 'number', required: true, min: 1, max: 365, inputMode: 'numeric', defaultValue: String(settings.max_rental_days) },
            { name: 'document_retention_days', label: L('Simpan dokumen pengenalan (hari selepas sewaan; 0 = jangan padam automatik)', 'Keep identity documents (days after the rental; 0 = never auto-delete)'), type: 'number', required: true, min: 0, max: 3650, inputMode: 'numeric', defaultValue: String(settings.document_retention_days) },
            { name: 'email_from', label: L('Emel penghantar', 'Sender email'), defaultValue: settings.email_from, placeholder: 'Bangi Car Rental <tempahan@bangicarrental.my>', hint: L('Domain mesti disahkan di Resend.', 'The domain must be verified in Resend.') },
            { name: 'email_reply_to', label: L('Emel balasan', 'Reply-to email'), type: 'email', inputMode: 'email', defaultValue: settings.email_reply_to },
            { name: 'admin_alert_email', label: L('Emel amaran admin', 'Admin alert email'), type: 'email', inputMode: 'email', defaultValue: settings.admin_alert_email, hint: L('Menerima amaran tempahan dibayar, dokumen untuk disemak dan isu bayaran.', 'Receives alerts for paid bookings, documents to review and payment issues.') },
          ]}
        />
      </Section>

      <Section id="integrations" title={L('Status integrasi', 'Integration status')}>
        <p className="field-hint mb-2">{L('Nilai rahsia ditetapkan sebagai pemboleh ubah persekitaran di Coolify dan tidak dipaparkan di sini.', 'Secret values are set as environment variables in Coolify and are never shown here.')}</p>
        <dl>
          <Row label={L('Mod Stripe', 'Stripe mode')}>
            <span className={mode === 'live' ? 'tag tag-live' : mode === 'test' ? 'tag tag-warn' : 'tag tag-danger'}>{mode === 'live' ? 'LIVE' : mode === 'test' ? 'TEST' : L('Tiada kunci', 'No key')}</span>
          </Row>
          <Row label="STRIPE_WEBHOOK_SECRET">{has('STRIPE_WEBHOOK_SECRET') ? yes : no}</Row>
          <Row label="RESEND_API_KEY">{has('RESEND_API_KEY') ? yes : no}</Row>
          <Row label="CRON_SECRET">{has('CRON_SECRET') ? yes : no}</Row>
          <Row label="APP_URL">{process.env.APP_URL || no}</Row>
          <Row label={L('Emel menunggu dihantar', 'Emails waiting to send')}>{pending.count ?? 0}</Row>
          <Row label={L('Emel gagal', 'Emails failed')}>{(failed.count ?? 0) > 0 ? <span className="tag tag-danger">{failed.count}</span> : 0}</Row>
        </dl>
      </Section>
    </div>
  );
}

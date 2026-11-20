import { AdminForm } from '@/components/admin/AdminForm';
import { Disclosure, Empty, PageTitle, Section } from '@/components/admin/ui';
import { AGREEMENT_PLACEHOLDERS } from '@/lib/agreements';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/time';
import type { AgreementTemplate } from '@/lib/types';
import { newDraftAction, publishAction, saveDraftAction } from './actions';

export default async function AdminAgreementPage() {
  await requireAdmin('/admin/agreement');
  const locale = await getLocale();
  const L = pick(locale);
  const { data } = await createServiceClient().from('agreement_templates').select('*').order('version', { ascending: false });
  const templates = (data ?? []) as AgreementTemplate[];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title={L('Perjanjian sewa', 'Rental agreement')} />
      <div className="notice text-sm leading-relaxed">
        <p>
          {L(
            'Penyewa menandatangani versi yang DITERBITKAN dalam bahasa tempahan mereka. Draf tidak digunakan. Menerbitkan versi baharu tidak mengubah perjanjian yang sudah ditandatangani.',
            'Renters sign the PUBLISHED version in their booking language. Drafts are never used. Publishing a new version does not change agreements already signed.',
          )}
        </p>
        <p className="mt-2">
          {L('Teks permulaan ialah draf untuk semakan anda dan bukan nasihat undang-undang. Dapatkan semakan guaman sebelum diterbitkan.', 'The starter text is a draft for your review and is not legal advice. Have it legally reviewed before publishing.')}
        </p>
      </div>

      <Section id="format" title={L('Format dan ruang ganti', 'Formatting and placeholders')}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{L('Baris bermula dengan "## " menjadi tajuk.', 'A line starting with "## " becomes a heading.')}</li>
          <li>{L('Baris bermula dengan "- " menjadi senarai.', 'A line starting with "- " becomes a bullet.')}</li>
          <li>{L('Ruang ganti di bawah diisi dengan butiran tempahan semasa perjanjian dijana.', 'The placeholders below are filled with the booking details when the agreement is generated.')}</li>
        </ul>
        <p className="mt-3 flex flex-wrap gap-1">
          {AGREEMENT_PLACEHOLDERS.map((name) => (
            <code key={name} className="tag font-mono text-xs">{`{{${name}}}`}</code>
          ))}
        </p>
      </Section>

      {(['ms', 'en'] as const).map((lang) => {
        const mine = templates.filter((t) => t.locale === lang);
        const published = mine.find((t) => t.status === 'published');
        const drafts = mine.filter((t) => t.status === 'draft');
        const archived = mine.filter((t) => t.status === 'archived');
        const name = lang === 'ms' ? 'Bahasa Melayu' : 'English';
        return (
          <Section key={lang} id={`lang-${lang}`} title={name} aside={published ? <span className="tag tag-live">{L('Diterbitkan', 'Published')} v{published.version}</span> : <span className="tag tag-danger">{L('Belum diterbitkan', 'Not published')}</span>}>
            {published ? (
              <Disclosure summary={`${L('Lihat versi diterbitkan', 'View published version')} v${published.version} · ${published.published_at ? formatDateTime(published.published_at, locale) : ''}`}>
                <h3 className="font-bold">{published.title}</h3>
                <pre className="mt-2 max-h-96 overflow-auto font-sans text-sm leading-relaxed whitespace-pre-wrap">{published.body}</pre>
              </Disclosure>
            ) : (
              <p className="notice notice-warn text-sm font-semibold">
                {L('Tiada versi diterbitkan. Penyewa dalam bahasa ini tidak boleh menandatangani sehingga satu versi diterbitkan.', 'No published version. Renters in this language cannot sign until one is published.')}
              </p>
            )}

            {drafts.map((draft) => (
              <div key={draft.id} className="mt-4 rounded-xl border border-line-soft p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <strong>{L('Draf', 'Draft')} v{draft.version}</strong>
                  <span className="text-sm text-muted">{L('Dikemas kini', 'Updated')} {formatDateTime(draft.updated_at, locale)}</span>
                </div>
                <AdminForm
                  action={saveDraftAction}
                  hidden={{ template_id: draft.id, form_id: `draft-${draft.id}-` }}
                  secondary
                  submitLabel={L('Simpan draf', 'Save draft')}
                  fields={[
                    { name: 'title', label: L('Tajuk', 'Title'), required: true, defaultValue: draft.title },
                    { name: 'body', label: L('Kandungan perjanjian', 'Agreement text'), type: 'textarea', rows: 22, required: true, mono: true, defaultValue: draft.body },
                  ]}
                />
                <div className="mt-4 border-t border-line-soft pt-4">
                  <p className="field-hint mb-2">{L('Simpan draf dahulu. Terbit menggunakan versi yang terakhir disimpan.', 'Save the draft first. Publishing uses the last saved version.')}</p>
                  <AdminForm
                    action={publishAction}
                    hidden={{ template_id: draft.id, form_id: `publish-${draft.id}-` }}
                    fields={[]}
                    submitLabel={`${L('Terbitkan', 'Publish')} v${draft.version}`}
                    confirm={`${L('Terbitkan versi', 'Publish version')} ${draft.version} (${name})? ${L('Ia menjadi teks yang ditandatangani oleh penyewa baharu. Pastikan anda telah menyemak dan meluluskannya.', 'It becomes the text new renters sign. Make sure you have reviewed and approved it.')}`}
                  />
                </div>
              </div>
            ))}

            {drafts.length === 0 && (
              <div className="mt-4">
                <AdminForm action={newDraftAction} hidden={{ locale: lang, form_id: `new-${lang}-` }} fields={[]} secondary compact submitLabel={published ? L('Draf baharu daripada versi diterbitkan', 'New draft from published version') : L('Buat draf', 'Create draft')} />
              </div>
            )}

            {archived.length > 0 && (
              <Disclosure summary={`${L('Versi lama', 'Earlier versions')} (${archived.length})`}>
                {archived.map((t) => (
                  <details key={t.id} className="border-b border-line-soft py-2 last:border-b-0">
                    <summary className="min-h-11 cursor-pointer text-sm font-semibold">v{t.version} · {t.published_at ? formatDateTime(t.published_at, locale) : ''}</summary>
                    <pre className="mt-2 max-h-72 overflow-auto font-sans text-sm whitespace-pre-wrap">{t.body}</pre>
                  </details>
                ))}
              </Disclosure>
            )}
            {mine.length === 0 && <Empty>{L('Tiada templat.', 'No templates.')}</Empty>}
          </Section>
        );
      })}
    </div>
  );
}

import Image from 'next/image';
import { AdminForm } from '@/components/admin/AdminForm';
import { FileUpload } from '@/components/admin/FileUpload';
import { Disclosure, Empty, PageTitle, Section } from '@/components/admin/ui';
import type { Field } from '@/lib/admin/form';
import { requireAdmin } from '@/lib/auth';
import { getLocale, pick } from '@/lib/i18n/server';
import { formatRM } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { createServiceClient } from '@/lib/supabase/server';
import type { Vehicle, VehicleModel } from '@/lib/types';
import { confirmationsAction, saveModelAction, saveVehicleAction } from './actions';

export default async function AdminFleetPage() {
  await requireAdmin('/admin/fleet');
  const L = pick(await getLocale());
  const db = createServiceClient();
  const [{ data: modelRows }, { data: vehicleRows }, settings] = await Promise.all([
    db.from('vehicle_models').select('*').order('sort_order').order('name'),
    db.from('vehicles').select('*').order('created_at'),
    getSettings(),
  ]);
  const models = (modelRows ?? []) as VehicleModel[];
  const vehicles = (vehicleRows ?? []) as Vehicle[];
  const rm = (sen: number) => (sen / 100).toFixed(2);

  const statusOptions = [
    { value: 'hidden', label: L('Tersembunyi (tidak dipaparkan)', 'Hidden (not shown)') },
    { value: 'preview', label: L('Pratonton ("Dalam perancangan", tidak boleh ditempah)', 'Preview ("Planned addition", cannot be booked)') },
    { value: 'bookable', label: L('Boleh ditempah', 'Bookable') },
  ];
  const statusLabel: Record<string, string> = { hidden: L('Tersembunyi', 'Hidden'), preview: L('Pratonton', 'Preview'), bookable: L('Boleh ditempah', 'Bookable') };

  const modelFields = (m?: VehicleModel): Field[] => [
    { name: 'name', label: L('Nama model', 'Model name'), required: true, defaultValue: m?.name },
    { name: 'slug', label: L('Slug URL', 'URL slug'), required: true, defaultValue: m?.slug, hint: L('Huruf kecil dan sengkang, cth. toyota-vellfire', 'Lowercase and hyphens, e.g. toyota-vellfire') },
    { name: 'seats', label: L('Tempat duduk', 'Seats'), type: 'number', required: true, min: 1, max: 20, inputMode: 'numeric', defaultValue: String(m?.seats ?? 7) },
    { name: 'transmission', label: L('Transmisi', 'Transmission'), type: 'select', required: true, defaultValue: m?.transmission ?? 'automatic', options: [{ value: 'automatic', label: L('Automatik', 'Automatic') }, { value: 'manual', label: 'Manual' }] },
    { name: 'tagline_ms', label: L('Keterangan ringkas (BM)', 'Short description (BM)'), defaultValue: m?.tagline_ms },
    { name: 'tagline_en', label: L('Keterangan ringkas (English)', 'Short description (English)'), defaultValue: m?.tagline_en },
    { name: 'daily_rate', label: L('Kadar setiap 24 jam (RM)', 'Rate per 24 hours (RM)'), inputMode: 'decimal', defaultValue: rm(m?.daily_rate_sen ?? 0), hint: L('Perubahan hanya untuk tempahan baharu.', 'Changes apply to new bookings only.') },
    { name: 'deposit', label: L('Deposit keselamatan (RM)', 'Security deposit (RM)'), inputMode: 'decimal', defaultValue: rm(m?.deposit_sen ?? 0), hint: L('Dikutip semasa ambil kereta, bukan dalam talian.', 'Collected at pickup, not online.') },
    { name: 'prep_buffer_minutes', label: L('Masa persediaan selepas pulang (minit)', 'Preparation time after return (minutes)'), type: 'number', min: 0, max: 2880, inputMode: 'numeric', defaultValue: String(m?.prep_buffer_minutes ?? 120) },
    { name: 'sort_order', label: L('Susunan paparan', 'Display order'), type: 'number', min: 0, max: 999, inputMode: 'numeric', defaultValue: String(m?.sort_order ?? models.length + 1) },
    { name: 'status', label: L('Keterlihatan', 'Visibility'), type: 'select', required: true, defaultValue: m?.status ?? 'preview', options: statusOptions },
  ];

  const unitFields = (modelId: string, v?: Vehicle): Field[] => [
    { name: 'label', label: L('Label dalaman', 'Internal label'), defaultValue: v?.label, placeholder: 'Serena 1' },
    { name: 'registration_no', label: L('No. pendaftaran', 'Registration no.'), defaultValue: v?.registration_no },
    { name: 'model_year', label: L('Tahun', 'Year'), type: 'number', min: 1990, max: 2100, inputMode: 'numeric', defaultValue: v?.model_year ? String(v.model_year) : '' },
    { name: 'colour', label: L('Warna', 'Colour'), defaultValue: v?.colour },
    { name: 'notes', label: L('Varian / nota dalaman', 'Variant / internal notes'), type: 'textarea', rows: 2, defaultValue: v?.notes, hint: L('Varian dipaparkan dalam perjanjian. Tidak dipaparkan di laman awam.', 'The variant appears in the agreement. Never shown on the public site.') },
    { name: 'active', label: L('Aktif (boleh diperuntukkan kepada tempahan)', 'Active (can be allocated to bookings)'), type: 'checkbox', defaultValue: v ? (v.active ? 'on' : '') : 'on' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle title={L('Armada', 'Fleet')} />

      <Section id="confirm" title={L('Pengesahan pelancaran', 'Launch confirmation')}>
        <p className="field-hint mb-3">{L('Tandakan apabila kadar dan deposit di bawah adalah nilai sebenar perniagaan anda, bukan nilai contoh.', 'Tick these once the rates and deposits below are your real business values, not sample values.')}</p>
        <AdminForm
          action={confirmationsAction}
          hidden={{ form_id: 'confirm-' }}
          compact
          submitLabel={L('Simpan pengesahan', 'Save confirmation')}
          fields={[
            { name: 'rates_confirmed', label: L('Kadar sewa adalah kadar sebenar', 'Rental rates are the real rates'), type: 'checkbox', defaultValue: settings.rates_confirmed ? 'on' : '' },
            { name: 'deposit_confirmed', label: L('Jumlah deposit adalah jumlah sebenar', 'Deposit amounts are the real amounts'), type: 'checkbox', defaultValue: settings.deposit_confirmed ? 'on' : '' },
          ]}
        />
      </Section>

      {models.length === 0 && <Empty>{L('Tiada model lagi.', 'No models yet.')}</Empty>}
      {models.map((model) => {
        const units = vehicles.filter((v) => v.model_id === model.id);
        return (
          <Section
            key={model.id}
            id={`model-${model.slug}`}
            title={model.name}
            aside={<span className={`tag ${model.status === 'bookable' ? 'tag-live' : model.status === 'hidden' ? 'tag-danger' : ''}`}>{statusLabel[model.status]}</span>}
          >
            <div className="flex flex-wrap items-center gap-4">
              {model.image_url ? (
                <Image src={model.image_url} alt="" width={160} height={90} unoptimized className="h-auto w-32 object-contain" />
              ) : (
                <span className="tag tag-warn">{L('Tiada gambar', 'No image')}</span>
              )}
              <div className="text-sm">
                <p className="font-bold">{model.daily_rate_sen > 0 ? `${formatRM(model.daily_rate_sen)} / 24 ${L('jam', 'hours')}` : L('Kadar belum ditetapkan', 'Rate not set')}</p>
                <p className="text-muted">{L('Deposit', 'Deposit')} {formatRM(model.deposit_sen)} · {units.filter((u) => u.active).length} {L('unit aktif', 'active unit(s)')}</p>
                <div className="mt-2">
                  <FileUpload url="/api/admin/model-image" fields={{ model_id: model.id }} label={L('Tukar gambar', 'Change image')} accept="image/jpeg,image/png,image/webp" />
                </div>
              </div>
            </div>

            <Disclosure summary={L('Sunting model', 'Edit model')}>
              <AdminForm action={saveModelAction} hidden={{ model_id: model.id, form_id: `model-${model.id}-` }} submitLabel={L('Simpan model', 'Save model')} fields={modelFields(model)} />
            </Disclosure>

            <h3 className="mt-4 font-bold">{L('Kereta fizikal', 'Physical cars')}</h3>
            {units.length === 0 && <Empty>{L('Tiada unit. Model tanpa unit tidak boleh ditempah.', 'No units. A model without a unit cannot be booked.')}</Empty>}
            {units.map((unit) => (
              <Disclosure key={unit.id} summary={`${unit.label || L('Unit', 'Unit')} · ${unit.registration_no || L('tiada no. pendaftaran', 'no registration no.')}${unit.active ? '' : ` · ${L('tidak aktif', 'inactive')}`}`}>
                <AdminForm action={saveVehicleAction} hidden={{ vehicle_id: unit.id, model_id: model.id, form_id: `unit-${unit.id}-` }} compact submitLabel={L('Simpan kereta', 'Save car')} fields={unitFields(model.id, unit)} />
              </Disclosure>
            ))}
            <Disclosure summary={`+ ${L('Tambah kereta fizikal', 'Add a physical car')}`}>
              <AdminForm action={saveVehicleAction} hidden={{ model_id: model.id, form_id: `unit-new-${model.id}-` }} compact submitLabel={L('Tambah kereta', 'Add car')} fields={unitFields(model.id)} />
            </Disclosure>
          </Section>
        );
      })}

      <Section id="new-model" title={L('Tambah model', 'Add a model')}>
        <p className="field-hint mb-3">{L('Model baharu bermula sebagai Pratonton atau Tersembunyi. Tambah unit fizikal untuk membolehkan tempahan.', 'A new model starts as Preview or Hidden. Add a physical unit to enable bookings.')}</p>
        <Disclosure summary={`+ ${L('Model baharu', 'New model')}`}>
          <AdminForm action={saveModelAction} hidden={{ form_id: 'model-new-' }} submitLabel={L('Tambah model', 'Add model')} fields={modelFields()} />
        </Disclosure>
      </Section>
    </div>
  );
}

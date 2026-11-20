'use client';

import { useActionState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { submitRequest, type RequestState } from './actions';

function RequestForm({ bookingId, kind, min, from, to }: { bookingId: string; kind: 'cancellation' | 'date_change'; min: string; from: string; to: string }) {
  const { d } = useI18n();
  const [state, action, pending] = useActionState<RequestState, FormData>(submitRequest, {});
  const isChange = kind === 'date_change';
  const error = state.error ? d.request[state.error] : state.generic ? d.errors.generic : null;

  return (
    <details className="rounded-xl border border-line bg-white">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold">
        {isChange ? d.bookings.requestChange : d.bookings.requestCancel}
      </summary>
      <div className="border-t border-line-soft p-4">
        {state.ok ? (
          <p role="status" className="notice font-semibold">{d.request.sent}</p>
        ) : (
          <form action={action} className="space-y-4" noValidate>
            <input type="hidden" name="booking_id" value={bookingId} />
            <input type="hidden" name="kind" value={kind} />
            <p className="text-sm leading-relaxed text-muted">{isChange ? d.request.changeIntro : d.request.cancelIntro}</p>
            {isChange && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="field-label">{d.request.newPickup}</span>
                  <input className="field-input" type="datetime-local" name="from" min={min} step={900} defaultValue={state.values?.from ?? from} required />
                </label>
                <label>
                  <span className="field-label">{d.request.newReturn}</span>
                  <input className="field-input" type="datetime-local" name="to" min={min} step={900} defaultValue={state.values?.to ?? to} required />
                </label>
              </div>
            )}
            <label className="block">
              <span className="field-label">
                {d.request.message}
                {isChange && <span className="font-normal text-muted"> ({d.common.optional})</span>}
              </span>
              <textarea className="field-input" name="message" rows={3} maxLength={1000} defaultValue={state.values?.message ?? ''} required={!isChange} />
            </label>
            {error && <p role="alert" className="field-error">{error}</p>}
            <button type="submit" className={`btn w-full sm:w-auto ${isChange ? '' : 'btn-danger'}`} disabled={pending}>
              {pending ? d.request.sending : d.request.send}
            </button>
          </form>
        )}
      </div>
    </details>
  );
}

export function RequestForms(props: { bookingId: string; min: string; from: string; to: string; pendingKinds: string[] }) {
  return (
    <div className="space-y-3">
      {!props.pendingKinds.includes('date_change') && <RequestForm {...props} kind="date_change" />}
      {!props.pendingKinds.includes('cancellation') && <RequestForm {...props} kind="cancellation" />}
    </div>
  );
}

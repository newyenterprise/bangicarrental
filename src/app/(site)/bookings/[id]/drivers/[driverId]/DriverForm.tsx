'use client';

import { useActionState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { saveDriver, type DriverState, type DriverValues } from './actions';

/**
 * Driver details. Inputs are uncontrolled and never remounted, so switching
 * language keeps what was typed; after a submit the server echoes the values back.
 */
export function DriverForm({
  driverId,
  initial,
  isPrimary,
  editable,
  minExpiry,
}: {
  driverId: string;
  initial: DriverValues;
  isPrimary: boolean;
  editable: boolean;
  minExpiry: string;
}) {
  const { d } = useI18n();
  const [state, action, pending] = useActionState<DriverState, FormData>(saveDriver, {});
  const values = state.values ?? initial;
  const err = (field: keyof DriverValues) => (state.errors?.[field] ? d.driver[state.errors[field]!] : null);

  const input = (field: keyof DriverValues, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="field-label" htmlFor={field}>{label}</label>
      <input
        id={field}
        name={field}
        defaultValue={values[field]}
        className="field-input disabled:bg-chip"
        disabled={!editable}
        aria-invalid={!!err(field)}
        aria-describedby={err(field) ? `${field}-error` : undefined}
        {...props}
      />
      {err(field) && <p id={`${field}-error`} className="field-error">{err(field)}</p>}
    </div>
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="driver_id" value={driverId} />
      {input('full_name', d.driver.fullName, { autoComplete: 'name', required: true })}
      <div>
        <label className="field-label" htmlFor="id_type">{d.driver.idType}</label>
        <select id="id_type" name="id_type" defaultValue={values.id_type} className="field-input disabled:bg-chip" disabled={!editable}>
          <option value="mykad">{d.driver.mykad}</option>
          <option value="passport">{d.driver.passport}</option>
        </select>
      </div>
      {input('id_number', d.driver.idNumber, { autoComplete: 'off', autoCapitalize: 'characters', required: true })}
      {input('date_of_birth', d.driver.dob, { type: 'date', autoComplete: 'bday', required: true })}
      {input('phone', d.driver.phone, { type: 'tel', inputMode: 'tel', autoComplete: 'tel', required: true })}
      {isPrimary && (
        <div>
          <label className="field-label" htmlFor="address">{d.driver.address}</label>
          <textarea
            id="address"
            name="address"
            rows={3}
            defaultValue={values.address}
            className="field-input disabled:bg-chip"
            autoComplete="street-address"
            disabled={!editable}
            aria-invalid={!!err('address')}
            required
          />
          {err('address') && <p className="field-error">{err('address')}</p>}
        </div>
      )}
      {input('licence_number', d.driver.licenceNumber, { autoComplete: 'off', autoCapitalize: 'characters', required: true })}
      {input('licence_expiry', d.driver.licenceExpiry, { type: 'date', min: minExpiry, required: true })}

      {state.generic && <p role="alert" className="field-error">{d.errors.generic}</p>}
      {state.errors && Object.keys(state.errors).length > 0 && <p role="alert" className="sr-only">{d.driver.errRequired}</p>}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn w-full sm:w-auto" disabled={pending}>
            {pending ? d.common.saving : d.driver.saveDetails}
          </button>
          {state.saved && !pending && <p role="status" className="text-sm font-semibold text-live-ink">✓ {d.driver.saved}</p>}
        </div>
      )}
    </form>
  );
}

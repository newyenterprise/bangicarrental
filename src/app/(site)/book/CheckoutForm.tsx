'use client';

import { useActionState } from 'react';
import { fmt } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { startCheckout, type CheckoutState } from './actions';

/**
 * Contact details + consent. Errors come back as dictionary keys, so they
 * re-render in the right language if the visitor switches mid-form, and what
 * they typed stays in place.
 */
export function CheckoutForm({
  modelId,
  from,
  to,
  amountLabel,
  holdMinutes,
  leadTimeHours,
  maxDays,
  accountEmail,
  defaultName,
  defaultPhone,
}: {
  modelId: string;
  from: string;
  to: string;
  amountLabel: string;
  holdMinutes: number;
  leadTimeHours: number;
  maxDays: number;
  accountEmail: string;
  defaultName: string;
  defaultPhone: string;
}) {
  const { d, locale } = useI18n();
  const [state, action, pending] = useActionState<CheckoutState, FormData>(startCheckout, {});
  const fieldError = (name: 'name' | 'email' | 'phone' | 'agree') => {
    const key = state.fieldErrors?.[name];
    return key ? d.errors[key as 'name' | 'email' | 'phone' | 'agree'] : null;
  };
  const formError = state.error
    ? fmt((d.errors as Record<string, string>)[state.error] ?? d.errors.generic, { hours: leadTimeHours, days: maxDays })
    : null;

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="model_id" value={modelId} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="locale" value={locale} />

      <div>
        <label className="field-label" htmlFor="name">{d.book.name}</label>
        <input id="name" name="name" defaultValue={state.values?.name ?? defaultName} className="field-input" autoComplete="name" required aria-invalid={!!fieldError('name')} aria-describedby={fieldError('name') ? 'name-error' : undefined} />
        {fieldError('name') && <p id="name-error" className="field-error">{fieldError('name')}</p>}
      </div>
      <div className="rounded-xl bg-mist px-3 py-2 text-sm">
        {d.book.accountEmail} <strong className="break-all" data-testid="account-email">{accountEmail}</strong>
      </div>
      <div>
        <label className="field-label" htmlFor="phone">{d.book.phone}</label>
        <input id="phone" name="phone" defaultValue={state.values?.phone ?? defaultPhone} type="tel" inputMode="tel" className="field-input" autoComplete="tel" required aria-invalid={!!fieldError('phone')} aria-describedby="phone-hint" />
        {fieldError('phone') ? <p className="field-error">{fieldError('phone')}</p> : <p id="phone-hint" className="field-hint">{d.book.phoneHint}</p>}
      </div>

      <div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input type="checkbox" name="agree" className="mt-1 h-5 w-5 shrink-0 accent-[#195642]" aria-invalid={!!fieldError('agree')} />
          <span className="text-sm leading-snug">{d.book.agree}</span>
        </label>
        {fieldError('agree') && <p className="field-error">{fieldError('agree')}</p>}
      </div>

      {formError && (
        <p role="alert" className="notice notice-danger font-semibold">
          {formError}
        </p>
      )}

      <button type="submit" className="btn w-full" disabled={pending}>
        {pending ? d.book.paying : fmt(d.book.payButton, { amount: amountLabel })}
      </button>
      <p className="field-hint text-center">
        {fmt(d.book.holdNote, { minutes: holdMinutes })} {d.book.securePayment}
      </p>
    </form>
  );
}

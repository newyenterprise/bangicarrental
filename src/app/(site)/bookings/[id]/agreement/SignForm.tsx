'use client';

import { useActionState } from 'react';
import { SignaturePad } from '@/components/renter/SignaturePad';
import { useI18n } from '@/lib/i18n/client';
import { sign, type SignState } from './actions';

export function SignForm({ agreementId, defaultName }: { agreementId: string; defaultName: string }) {
  const { d } = useI18n();
  const [state, action, pending] = useActionState<SignState, FormData>(sign, {});

  if (state.signed) {
    return (
      <p role="status" className="notice font-semibold" data-testid="signed-confirmation">
        ✓ {d.agreement.signedTitle}
      </p>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="agreement_id" value={agreementId} />
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" name="accept" className="mt-1 h-5 w-5 shrink-0 accent-[#195642]" aria-invalid={state.error === 'errAccept'} />
        <span className="leading-snug font-semibold">{d.agreement.acceptLabel}</span>
      </label>
      <div>
        <label className="field-label" htmlFor="signer_name">{d.agreement.signerName}</label>
        <input
          id="signer_name"
          name="signer_name"
          className="field-input"
          autoComplete="name"
          defaultValue={state.values?.name ?? defaultName}
          aria-invalid={state.error === 'errName'}
          required
        />
      </div>
      <SignaturePad name="signature" label={d.agreement.signature} hint={d.agreement.signatureHint} clearLabel={d.agreement.clear} invalid={state.error === 'errSignature'} />
      {state.error && <p role="alert" className="notice notice-danger font-semibold">{d.agreement[state.error]}</p>}
      <button type="submit" className="btn w-full" disabled={pending}>
        {pending ? d.agreement.signing : d.agreement.sign}
      </button>
    </form>
  );
}

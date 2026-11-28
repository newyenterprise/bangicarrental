'use client';

import { useActionState, useState } from 'react';
import { PasswordFields } from '@/components/PasswordFields';
import { fmt } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { completeReset, requestReset, resendReset, type ResetState } from './actions';

function errorText(d: ReturnType<typeof useI18n>['d'], key: ResetState['error']): string | null {
  if (!key) return null;
  return key === 'errRules' || key === 'errMismatch' ? d.password[key] : d.forgot[key];
}

export function ForgotForm({ next }: { next: string }) {
  const { d } = useI18n();
  const [sent, sendAction, sending] = useActionState<ResetState, FormData>(requestReset, { step: 'email' });
  const [restart, setRestart] = useState(false);

  if (sent.step !== 'code' || restart) {
    return (
      <form action={(form) => { setRestart(false); sendAction(form); }} className="space-y-4" noValidate>
        <div>
          <label className="field-label" htmlFor="email">{d.forgot.email}</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={sent.email ?? ''} required className="field-input" aria-invalid={!!sent.error} />
          {sent.error && <p role="alert" className="field-error">{errorText(d, sent.error)}</p>}
        </div>
        <button type="submit" className="btn w-full" disabled={sending}>
          {sending ? d.forgot.sending : d.forgot.send}
        </button>
      </form>
    );
  }

  return <CodeStep next={next} start={sent} onBack={() => setRestart(true)} />;
}

function CodeStep({ next, start, onBack }: { next: string; start: ResetState; onBack: () => void }) {
  const { d } = useI18n();
  const [state, action, pending] = useActionState<ResetState, FormData>(completeReset, start);
  const [resent, resendAction, resending] = useActionState<ResetState, FormData>(resendReset, start);
  const error = state.error ?? resent.error;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">{d.forgot.codeTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{fmt(d.forgot.codeIntro, { email: start.email ?? '' })}</p>
      </div>
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <input type="email" name="username" autoComplete="username" value={start.email ?? ''} readOnly hidden />
        <div>
          <label className="field-label" htmlFor="code">{d.forgot.code}</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            className="field-input text-center text-2xl font-bold tracking-[0.4em]"
            aria-invalid={state.error === 'errCode' || state.error === 'errCodeFormat'}
          />
        </div>
        <PasswordFields label={d.forgot.newPassword} rulesInvalid={state.error === 'errRules'} mismatch={state.error === 'errMismatch'} />
        {error && <p role="alert" className="notice notice-danger font-semibold">{errorText(d, error)}</p>}
        {resent.resent && !error && <p role="status" className="field-hint">✓ {d.forgot.resent}</p>}
        <button type="submit" className="btn w-full" disabled={pending}>
          {pending ? d.forgot.saving : d.forgot.save}
        </button>
      </form>
      <div className="flex flex-wrap justify-between gap-2">
        <form action={resendAction}>
          <button type="submit" className="btn-plain text-sm underline" disabled={resending}>
            {resending ? d.forgot.sending : d.forgot.resend}
          </button>
        </form>
        <button type="button" className="btn-plain text-sm underline" onClick={onBack}>
          {d.forgot.useAnotherEmail}
        </button>
      </div>
    </div>
  );
}

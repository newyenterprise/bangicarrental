'use client';

import { useActionState, useState } from 'react';
import { fmt } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { requestCode, verifyCode, type SignInState } from './actions';

export function SignInForm({ next }: { next: string }) {
  const { d } = useI18n();
  const [sent, sendAction, sending] = useActionState<SignInState, FormData>(requestCode, { step: 'email' });
  const [checked, verifyAction, verifying] = useActionState<SignInState, FormData>(verifyCode, { step: 'code' });
  const [restart, setRestart] = useState(false);

  const onCodeStep = sent.step === 'code' && !restart && checked.step !== 'email';
  const email = sent.email ?? '';

  if (!onCodeStep) {
    return (
      <form action={(form) => { setRestart(false); sendAction(form); }} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="field-label" htmlFor="email">{d.auth.email}</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={email} required className="field-input" aria-invalid={!!sent.error} />
          {sent.error && <p role="alert" className="field-error">{d.auth[sent.error]}</p>}
        </div>
        <button type="submit" className="btn w-full" disabled={sending}>
          {sending ? d.auth.sending : d.auth.sendCode}
        </button>
        <p className="field-hint text-center">{d.auth.noPassword}</p>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">{d.auth.codeTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{fmt(d.auth.codeIntro, { email })}</p>
      </div>
      <form action={verifyAction} className="space-y-4" noValidate>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="field-label" htmlFor="code">{d.auth.code}</label>
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
            aria-invalid={!!checked.error}
          />
          {checked.error && <p role="alert" className="field-error">{d.auth[checked.error]}</p>}
        </div>
        <button type="submit" className="btn w-full" disabled={verifying}>
          {verifying ? d.auth.verifying : d.auth.verify}
        </button>
      </form>
      <div className="flex flex-wrap justify-between gap-2">
        <form action={sendAction}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="btn-plain text-sm underline" disabled={sending}>
            {sending ? d.auth.sending : d.auth.resend}
          </button>
        </form>
        <button type="button" className="btn-plain text-sm underline" onClick={() => setRestart(true)}>
          {d.auth.useAnotherEmail}
        </button>
      </div>
      {sent.error && <p role="alert" className="field-error">{d.auth[sent.error]}</p>}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { PasswordFields } from '@/components/PasswordFields';
import { fmt } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { resendSignUpCode, startSignUp, verifySignUp, type SignUpState } from './actions';

export function SignUpForm({ next }: { next: string }) {
  const { d } = useI18n();
  const [details, detailsAction, submitting] = useActionState<SignUpState, FormData>(startSignUp, { step: 'details' });
  const [restart, setRestart] = useState(false);
  // Kept only in this page's memory, and sent once more with the code so the
  // account ends up with exactly this password.
  const [password, setPassword] = useState('');

  const onCode = details.step === 'code' && !restart;
  const values = details.values;
  const errorText = (key: SignUpState['error']) =>
    !key ? null : key === 'errRules' || key === 'errMismatch' ? d.password[key] : d.signup[key];

  if (!onCode) {
    return (
      <form action={(form) => { setRestart(false); detailsAction(form); }} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="field-label" htmlFor="name">{d.signup.name}</label>
          <input id="name" name="name" autoComplete="name" defaultValue={values?.name ?? ''} required className="field-input" aria-invalid={details.error === 'errName'} />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">{d.signup.phone}</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={values?.phone ?? ''} required className="field-input" aria-invalid={details.error === 'errPhone'} aria-describedby="phone-hint" />
          <p id="phone-hint" className="field-hint">{d.book.phoneHint}</p>
        </div>
        <div>
          <label className="field-label" htmlFor="email">{d.signup.email}</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={values?.email ?? ''} required className="field-input" aria-invalid={details.error === 'errEmail' || details.error === 'errExists'} />
        </div>
        <PasswordFields label={d.auth.password} onChange={setPassword} rulesInvalid={details.error === 'errRules'} mismatch={details.error === 'errMismatch'} />
        {details.error && (
          <p role="alert" className="notice notice-danger font-semibold">
            {errorText(details.error)}
            {details.error === 'errExists' && (
              <>
                {' '}
                <Link href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="underline">{d.signup.signInLink}</Link>
              </>
            )}
          </p>
        )}
        <button type="submit" className="btn w-full" disabled={submitting}>
          {submitting ? d.signup.submitting : d.signup.submit}
        </button>
      </form>
    );
  }

  return <CodeStep next={next} start={details} password={password} onBack={() => setRestart(true)} />;
}

function CodeStep({ next, start, password, onBack }: { next: string; start: SignUpState; password: string; onBack: () => void }) {
  const { d } = useI18n();
  const [checked, verifyAction, verifying] = useActionState<SignUpState, FormData>(verifySignUp, start);
  const [resent, resendAction, resending] = useActionState<SignUpState, FormData>(resendSignUpCode, start);
  const error = checked.error ?? resent.error;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">{d.signup.codeTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">{fmt(d.signup.codeIntro, { email: start.values?.email ?? '' })}</p>
      </div>
      <form action={verifyAction} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="password" value={password} />
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
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error === 'errRules' || error === 'errMismatch' ? d.password[error] : d.signup[error]}
          </p>
        )}
        {resent.resent && !error && <p role="status" className="field-hint">✓ {d.signup.resend}</p>}
        <button type="submit" className="btn w-full" disabled={verifying}>
          {verifying ? d.signup.verifying : d.signup.verify}
        </button>
      </form>
      <div className="flex flex-wrap justify-between gap-2">
        <form action={resendAction}>
          <button type="submit" className="btn-plain text-sm underline" disabled={resending}>
            {resending ? d.auth.sending : d.signup.resend}
          </button>
        </form>
        <button type="button" className="btn-plain text-sm underline" onClick={onBack}>
          {d.signup.back}
        </button>
      </div>
    </div>
  );
}

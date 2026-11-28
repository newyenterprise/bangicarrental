'use client';

import { useActionState, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { passwordProblems, type PasswordRule } from '@/lib/password';
import { setPassword, type PasswordState } from './actions';

const RULES: { rule: PasswordRule; key: 'ruleLength' | 'ruleLower' | 'ruleUpper' | 'ruleDigit' | 'ruleSymbol' }[] = [
  { rule: 'length', key: 'ruleLength' },
  { rule: 'lower', key: 'ruleLower' },
  { rule: 'upper', key: 'ruleUpper' },
  { rule: 'digit', key: 'ruleDigit' },
  { rule: 'symbol', key: 'ruleSymbol' },
];

export function PasswordForm({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const { d } = useI18n();
  const [state, action, pending] = useActionState<PasswordState, FormData>(setPassword, {});
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const missing = new Set(passwordProblems(value));

  if (state.ok) {
    return (
      <p role="status" className="notice font-semibold" data-testid="password-saved">
        {d.password.saved}
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div>
        <label className="field-label" htmlFor="password">{d.password.newPassword}</label>
        <div className="flex gap-2">
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="field-input"
            aria-describedby="password-rules"
            aria-invalid={state.error === 'errRules'}
          />
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => setShow((v) => !v)} aria-pressed={show}>
            {show ? d.password.hide : d.password.show}
          </button>
        </div>
      </div>
      <div id="password-rules">
        <p className="text-sm font-bold">{d.password.rulesTitle}</p>
        <ul className="mt-1 space-y-1 text-sm">
          {RULES.map(({ rule, key }) => {
            const ok = value !== '' && !missing.has(rule);
            return (
              <li key={rule} className={ok ? 'text-live-ink' : 'text-muted'}>
                <span aria-hidden>{ok ? '✓' : '○'}</span> {d.password[key]}
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <label className="field-label" htmlFor="confirm">{d.password.confirm}</label>
        <input id="confirm" name="confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required className="field-input" aria-invalid={state.error === 'errMismatch'} />
      </div>
      {state.error && (
        <p role="alert" className="notice notice-danger font-semibold">
          {d.password[state.error]}
        </p>
      )}
      <button type="submit" className="btn w-full sm:w-auto" disabled={pending}>
        {pending ? d.password.saving : hasPassword ? d.password.change : d.password.set}
      </button>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { passwordProblems, type PasswordRule } from '@/lib/password';

const RULES: { rule: PasswordRule; key: 'ruleLength' | 'ruleLower' | 'ruleUpper' | 'ruleDigit' | 'ruleSymbol' }[] = [
  { rule: 'length', key: 'ruleLength' },
  { rule: 'lower', key: 'ruleLower' },
  { rule: 'upper', key: 'ruleUpper' },
  { rule: 'digit', key: 'ruleDigit' },
  { rule: 'symbol', key: 'ruleSymbol' },
];

/**
 * New-password + confirm fields with a live checklist of the password rules.
 * Field names are "password" and "confirm".
 */
export function PasswordFields({
  label,
  rulesInvalid,
  mismatch,
  onChange,
}: {
  label: string;
  rulesInvalid?: boolean;
  mismatch?: boolean;
  onChange?: (value: string) => void;
}) {
  const { d } = useI18n();
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const missing = new Set(passwordProblems(value));

  return (
    <>
      <div>
        <label className="field-label" htmlFor="password">{label}</label>
        <div className="flex gap-2">
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              onChange?.(e.target.value);
            }}
            className="field-input"
            aria-describedby="password-rules"
            aria-invalid={rulesInvalid}
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
        <input id="confirm" name="confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required className="field-input" aria-invalid={mismatch} />
      </div>
    </>
  );
}

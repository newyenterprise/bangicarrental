'use client';

import { useActionState } from 'react';
import { PasswordFields } from '@/components/PasswordFields';
import { useI18n } from '@/lib/i18n/client';
import { setPassword, type PasswordState } from './actions';

export function PasswordForm({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const { d } = useI18n();
  const [state, action, pending] = useActionState<PasswordState, FormData>(setPassword, {});

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
      <PasswordFields label={d.password.newPassword} rulesInvalid={state.error === 'errRules'} mismatch={state.error === 'errMismatch'} />
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

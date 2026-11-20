'use client';

import { useActionState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { submitDriver, type SubmitState } from './actions';

export function SubmitDriver({ driverId, ready }: { driverId: string; ready: boolean }) {
  const { d } = useI18n();
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitDriver, {});
  const error = state.error ? d.driver[state.error] : state.generic ? d.errors.generic : null;
  return (
    <form action={action}>
      <input type="hidden" name="driver_id" value={driverId} />
      <button type="submit" className="btn w-full" disabled={!ready || pending} aria-describedby="submit-hint">
        {pending ? d.driver.submitting : d.driver.submit}
      </button>
      {!ready && <p id="submit-hint" className="field-hint text-center">{d.driver.submitHint}</p>}
      {error && <p role="alert" className="field-error text-center">{error}</p>}
    </form>
  );
}

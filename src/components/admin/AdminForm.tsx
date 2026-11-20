'use client';

import { useActionState, useRef, useState } from 'react';
import { useL } from '@/lib/i18n/client';
import type { Field, FormState } from '@/lib/admin/form';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/**
 * Config-driven admin form. Shows the action's bilingual result, keeps typed
 * values after a failed submit, and (when `confirm` is set) asks for an
 * explicit second step in an accessible dialog before submitting.
 */
export function AdminForm({
  action,
  fields,
  hidden,
  submitLabel,
  confirm,
  confirmFields,
  danger,
  secondary,
  compact,
  disabled,
}: {
  action: Action;
  fields: Field[];
  hidden?: Record<string, string>;
  submitLabel: string;
  /** Confirmation text. When present the submit button opens a dialog first. */
  confirm?: string;
  /** Field names whose current values are repeated in the confirmation dialog. */
  confirmFields?: string[];
  danger?: boolean;
  secondary?: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  const L = useL();
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [summary, setSummary] = useState<[string, string][]>([]);
  const value = (field: Field) => state.values?.[field.name] ?? field.defaultValue ?? '';
  const buttonClass = `btn ${compact ? 'btn-sm' : ''} ${danger ? 'btn-danger' : ''} ${secondary ? 'btn-secondary' : ''}`;

  const openConfirm = () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    setSummary(
      (confirmFields ?? []).map((name) => {
        const field = fields.find((f) => f.name === name);
        const raw = String(data.get(name) ?? '');
        const label = field?.options?.find((o) => o.value === raw)?.label ?? raw;
        return [field?.label ?? name, label] as [string, string];
      }),
    );
    dialogRef.current?.showModal();
  };

  return (
    <form ref={formRef} action={formAction} className={compact ? 'space-y-3' : 'space-y-4'}>
      {Object.entries(hidden ?? {}).map(([name, v]) => (
        <input key={name} type="hidden" name={name} value={v} />
      ))}
      {fields.map((field) => {
        const id = `${hidden?.form_id ?? ''}${field.name}`;
        const common = {
          id,
          name: field.name,
          required: field.required,
          placeholder: field.placeholder,
          'aria-describedby': field.hint ? `${id}-hint` : undefined,
        };
        if (field.type === 'checkbox') {
          return (
            <div key={field.name}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input type="checkbox" name={field.name} defaultChecked={state.values ? state.values[field.name] === 'on' : field.defaultValue === 'on'} className="mt-1 h-5 w-5 shrink-0 accent-[#195642]" />
                <span className="text-sm leading-snug font-semibold">{field.label}</span>
              </label>
              {field.hint && <p className="field-hint">{field.hint}</p>}
            </div>
          );
        }
        return (
          <div key={field.name}>
            <label className="field-label" htmlFor={id}>
              {field.label}
              {!field.required && field.type !== 'select' && <span className="font-normal text-muted"> ({L('pilihan', 'optional')})</span>}
            </label>
            {field.type === 'textarea' ? (
              <textarea {...common} rows={field.rows ?? 3} defaultValue={value(field)} className={`field-input ${field.mono ? 'font-mono text-sm' : ''}`} />
            ) : field.type === 'select' ? (
              <select {...common} defaultValue={value(field)} className="field-input">
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                type={field.type ?? 'text'}
                defaultValue={value(field)}
                min={field.min}
                max={field.max}
                step={field.step ?? (field.type === 'datetime-local' ? 900 : undefined)}
                inputMode={field.inputMode}
                className="field-input"
              />
            )}
            {field.hint && (
              <p id={`${id}-hint`} className="field-hint">
                {field.hint}
              </p>
            )}
          </div>
        );
      })}

      {state.error && (
        <p role="alert" className="notice notice-danger font-semibold whitespace-pre-line">
          {L(...state.error)}
        </p>
      )}
      {state.warn && (
        <p role="status" className="notice notice-warn font-semibold whitespace-pre-line">
          {L(...state.warn)}
        </p>
      )}
      {state.ok && (
        <p role="status" className="notice font-semibold">
          {L(...state.ok)}
        </p>
      )}

      {confirm ? (
        <>
          <button type="button" className={buttonClass} disabled={pending || disabled} onClick={openConfirm}>
            {pending ? L('Sedang diproses…', 'Working…') : submitLabel}
          </button>
          <dialog ref={dialogRef} className="m-auto w-[min(440px,92vw)] rounded-2xl p-6 text-ink backdrop:bg-[#0c2c24aa]" aria-labelledby={`${hidden?.form_id ?? submitLabel}-confirm`}>
            <h3 id={`${hidden?.form_id ?? submitLabel}-confirm`} className="text-xl font-bold tracking-tight">
              {L('Sahkan tindakan', 'Confirm action')}
            </h3>
            <p className="mt-2 leading-relaxed whitespace-pre-line">{confirm}</p>
            {summary.length > 0 && (
              <dl className="mt-2">
                {summary.map(([label, v]) => (
                  <div key={label} className="row-line">
                    <dt>{label}</dt>
                    <dd>{v || '-'}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row-reverse">
              <button type="submit" className={`btn ${danger ? 'btn-danger' : ''}`} onClick={() => dialogRef.current?.close()}>
                {L('Ya, teruskan', 'Yes, continue')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => dialogRef.current?.close()}>
                {L('Batal', 'Cancel')}
              </button>
            </div>
          </dialog>
        </>
      ) : (
        <button type="submit" className={buttonClass} disabled={pending || disabled}>
          {pending ? L('Sedang diproses…', 'Working…') : submitLabel}
        </button>
      )}
    </form>
  );
}

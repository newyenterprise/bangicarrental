'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmt } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;

type ErrorKey = 'errFileType' | 'errFileSize' | 'errUpload';

/**
 * One document slot. On a phone the file picker offers the camera. The file
 * goes to our own server (which re-checks size and real file type) with
 * visible progress; nothing is sent to storage directly from the browser.
 */
export function DocumentUpload({
  driverId,
  kind,
  label,
  documentId,
  editable,
}: {
  driverId: string;
  kind: 'identity' | 'licence';
  label: string;
  documentId: string | null;
  editable: boolean;
}) {
  const { d } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [justUploaded, setJustUploaded] = useState(false);

  const upload = (file: File) => {
    setError(null);
    setJustUploaded(false);
    // Phones sometimes report an empty type for HEIC, so the extension is accepted too; the server decides for real.
    if (!(TYPES.includes(file.type) || (!file.type && EXTENSIONS.test(file.name)))) return setError('errFileType');
    if (file.size > MAX_BYTES) return setError('errFileSize');

    const body = new FormData();
    body.append('driver_id', driverId);
    body.append('kind', kind);
    body.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads/document');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => {
      setProgress(null);
      setError('errUpload');
    };
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.ok) {
        setJustUploaded(true);
        router.refresh();
      } else {
        const code = xhr.response?.error;
        setError(code === 'errFileType' || code === 'errFileSize' ? code : 'errUpload');
      }
    };
    setProgress(0);
    xhr.send(body);
  };

  const busy = progress !== null;
  const has = !!documentId;
  const inputId = `file-${kind}`;

  return (
    <div className="rounded-xl border border-line-soft p-3" data-testid={`doc-${kind}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <strong id={`${inputId}-label`}>{label}</strong>
        <span className={`tag ${has ? 'tag-live' : ''}`}>{has ? d.driver.uploaded : d.bookings.todo}</span>
      </div>

      {busy && (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="h-2.5 overflow-hidden rounded-full bg-chip" aria-hidden>
            <div className="h-full rounded-full bg-green transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <p className="field-hint">{fmt(d.driver.uploading, { percent: progress ?? 0 })}</p>
        </div>
      )}
      {error && <p role="alert" className="field-error">{d.driver[error]}</p>}
      {justUploaded && !busy && !error && <p role="status" className="mt-2 text-sm font-semibold text-live-ink">✓ {d.driver.uploaded}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {editable && (
          <>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              className="sr-only"
              // No `capture` attribute on purpose: phones then offer both the camera and existing files.
              accept="image/*,application/pdf"
              aria-labelledby={`${inputId}-label`}
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) upload(file);
              }}
            />
            <button type="button" className={`btn btn-sm ${has ? 'btn-secondary' : ''}`} disabled={busy} onClick={() => inputRef.current?.click()}>
              {has ? d.driver.replace : d.driver.takePhoto}
            </button>
          </>
        )}
        {has && (
          <a href={`/api/documents/${documentId}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary">
            {d.driver.viewFile}
          </a>
        )}
      </div>
    </div>
  );
}

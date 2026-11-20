'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useL } from '@/lib/i18n/client';

/** Admin-only upload (condition photos, model images) with progress, via an authenticated route. */
export function FileUpload({
  url,
  fields,
  label,
  accept,
  multiple,
  capture,
}: {
  url: string;
  fields: Record<string, string>;
  label: string;
  accept: string;
  multiple?: boolean;
  capture?: boolean;
}) {
  const L = useL();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (file: File) =>
    new Promise<void>((resolve, reject) => {
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.append(key, value);
      body.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let code = 'failed';
        try {
          code = JSON.parse(xhr.responseText).error ?? code;
        } catch {
          // keep the generic code
        }
        reject(new Error(code));
      };
      xhr.onerror = () => reject(new Error('network'));
      xhr.send(body);
    });

  const onChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setError(null);
    try {
      for (const file of files) {
        setProgress(0);
        await send(file);
      }
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.message : 'failed';
      setError(
        code === 'type'
          ? L('Jenis fail tidak disokong. Guna JPG, PNG atau WEBP.', 'Unsupported file type. Use JPG, PNG or WEBP.')
          : code === 'size'
            ? L('Fail terlalu besar.', 'The file is too large.')
            : L('Muat naik gagal. Cuba lagi.', 'Upload failed. Please try again.'),
      );
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <label className={`btn btn-secondary btn-sm ${progress !== null ? 'pointer-events-none opacity-60' : ''}`}>
        {progress !== null ? `${L('Memuat naik', 'Uploading')}… ${progress}%` : label}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          {...(capture ? { capture: 'environment' as const } : {})}
          onChange={onChange}
          disabled={progress !== null}
        />
      </label>
      {progress !== null && <progress className="mt-2 block w-full" max={100} value={progress} aria-label={L('Kemajuan muat naik', 'Upload progress')} />}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

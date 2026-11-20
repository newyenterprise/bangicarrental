import 'server-only';
import { createServiceClient } from './supabase/server';

export const BUCKETS = {
  documents: 'renter-documents',
  agreements: 'agreements',
  handover: 'handover-photos',
  modelImages: 'model-images',
} as const;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60;

const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', ext: 'webp', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => ascii(b, 0, 5) === '%PDF-' },
  {
    mime: 'image/heic',
    ext: 'heic',
    test: (b) => ascii(b, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heif'].includes(ascii(b, 8, 12)),
  },
];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/**
 * Identifies a file from its first bytes rather than trusting the name or the
 * browser-supplied type. Returns null when it is not an accepted format.
 */
export function sniffFile(bytes: Uint8Array, allowPdf = true): { mime: string; ext: string } | null {
  const match = SIGNATURES.find((s) => s.test(bytes));
  if (!match || (!allowPdf && match.mime === 'application/pdf')) return null;
  return { mime: match.mime, ext: match.ext };
}

export async function uploadPrivate(bucket: string, path: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
  const { error } = await createServiceClient().storage.from(bucket).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed (${bucket})`);
}

/** Short-lived link. Only create one after checking the caller may see the file. */
export async function signedUrl(bucket: string, path: string, downloadName?: string): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .storage.from(bucket)
    .createSignedUrl(path, SIGNED_URL_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function downloadPrivate(bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await createServiceClient().storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeObjects(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await createServiceClient().storage.from(bucket).remove(paths);
}

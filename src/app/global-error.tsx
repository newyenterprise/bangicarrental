'use client';

// Last-resort boundary (the root layout itself failed), so it cannot use the dictionaries.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ms">
      <body style={{ fontFamily: 'Arial, sans-serif', background: '#faf9f4', color: '#163c33', padding: 24 }}>
        <h1>Ada masalah di pihak kami / Something went wrong</h1>
        <p>Sila cuba semula sebentar lagi. / Please try again shortly.</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{ padding: '12px 18px', borderRadius: 12, border: 0, background: '#195642', color: '#fff', fontWeight: 700 }}
        >
          Cuba semula / Try again
        </button>
      </body>
    </html>
  );
}

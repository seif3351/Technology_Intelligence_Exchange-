'use client';

/** Last-resort error page when the root layout itself fails (it replaces the whole document). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main>
          <h1>Automotive Technology Exchange is temporarily unavailable</h1>
          <p>Please try again in a moment. Your data is safe.</p>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

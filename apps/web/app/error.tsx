'use client';

import Link from 'next/link';

/**
 * Shown when a page fails to render (for example while the API is unreachable).
 * The error itself is never displayed: it may contain internals.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="stack narrow">
      <h1>Something went wrong</h1>
      <p>
        This page could not be loaded. The service may be briefly unavailable; your data is safe. Please try
        again in a moment.
      </p>
      <div className="row">
        <button type="button" className="primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/">Go to the start page</Link>
      </div>
    </div>
  );
}

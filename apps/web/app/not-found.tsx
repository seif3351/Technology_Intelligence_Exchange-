import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="stack narrow">
      <h1>Not found</h1>
      <p>
        This page does not exist, or it is not available to you. Offerings disappear from public view when
        they are unpublished or when their supplier is no longer verified.
      </p>
      <div className="row">
        <Link href="/search">Search technologies</Link>
        <Link href="/">Start page</Link>
      </div>
    </div>
  );
}

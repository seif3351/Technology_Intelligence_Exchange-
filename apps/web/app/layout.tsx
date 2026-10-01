import type { Metadata } from 'next';
import Link from 'next/link';
import { logout } from '@/lib/actions/auth';
import { currentUser } from '@/lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: 'Automotive Technology Exchange',
  description: 'Evidence-backed technical discovery for the automotive ecosystem.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const isSupplier = me?.memberships.some((m) => m.organizationKind !== 'buyer') ?? false;
  const isBuyer =
    me?.memberships.some((m) => m.organizationKind === 'buyer' || m.organizationKind === 'hybrid') ?? false;
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Automotive Technology Exchange
          </Link>
          <nav>
            <Link href="/search">Search</Link>
            <Link href="/technologies">Technologies</Link>
            {isBuyer ? <Link href="/buyer/requirements">Requirements</Link> : null}
            {isBuyer ? <Link href="/buyer/requests">Requests</Link> : null}
            {isSupplier ? <Link href="/workspace">Supplier workspace</Link> : null}
            {me?.user.platformRole === 'platform_admin' ? <Link href="/admin">Admin</Link> : null}
            <Link href="/docs/mcp">AI agents (MCP)</Link>
          </nav>
          <div className="user">
            {me ? (
              <>
                <Link href="/account">{me.user.displayName}</Link>
                <form action={logout}>
                  <button type="submit">Sign out</button>
                </form>
              </>
            ) : (
              <Link href="/login">Sign in</Link>
            )}
          </div>
        </header>
        {me && !me.user.emailVerified ? (
          <div className="banner" role="status">
            Please confirm your email address — check your inbox or{' '}
            <Link href="/account">send a new link</Link>.
          </div>
        ) : null}
        <main>{children}</main>
        <footer>
          Discovery before procurement. Supplier statements are shown with their provenance; they are not
          endorsements. Records marked “Demo data” are synthetic. <Link href="/terms">Terms</Link> ·{' '}
          <Link href="/privacy">Privacy</Link>
        </footer>
      </body>
    </html>
  );
}

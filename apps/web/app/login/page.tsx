import Link from 'next/link';
import { webConfig } from '@/lib/config';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  return (
    <div className="stack narrower">
      <h1>Sign in</h1>
      {reset ? <p className="success">Your password was changed. Sign in with the new password.</p> : null}
      <LoginForm next={next ?? '/'} />
      <p className="small">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="small">
        New here? Use the link in your invitation, or <Link href="/signup">create an account</Link> if
        registration is open.
      </p>
      {webConfig.showDemoAccounts ? (
        <p className="small muted">
          Demo accounts (synthetic data): buyer@aurelia-motors.example, owner@northstar-ai.example,
          admin@atx.example — password “demo-password-2026”.
        </p>
      ) : null}
    </div>
  );
}

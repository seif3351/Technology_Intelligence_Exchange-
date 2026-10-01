import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="stack narrower">
      <h1>Sign in</h1>
      <LoginForm next={next ?? '/'} />
      <p className="small muted">
        Demo accounts (synthetic data): buyer@aurelia-motors.example, owner@northstar-ai.example, admin@atx.example — password
        “demo-password-2026”.
      </p>
    </div>
  );
}

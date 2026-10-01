import { ActionForm } from '@/components/action-form';
import { requestPasswordReset } from '@/lib/actions/account';

export default function ForgotPasswordPage() {
  return (
    <div className="stack narrower">
      <h1>Reset your password</h1>
      <ActionForm action={requestPasswordReset} submitLabel="Send reset link">
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>
      </ActionForm>
    </div>
  );
}

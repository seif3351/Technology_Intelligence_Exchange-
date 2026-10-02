import type { Metadata } from 'next';
import { OAuthAuthorizationPreview } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { ApiError, api, currentUser } from '@/lib/api';
import { describeScope } from '@/lib/scopes';
import { ConsentForm } from './consent-form';

export const metadata: Metadata = { title: 'Connect an AI application' };

export const dynamic = 'force-dynamic';

const PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'state',
  'resource',
] as const;
type Params = Partial<Record<(typeof PARAMS)[number], string>>;

/**
 * OAuth 2.1 authorization endpoint (consent screen) for MCP hosts. The API
 * validates the request; this page only asks the signed-in user.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const raw = await searchParams;
  const params: Params = Object.fromEntries(
    PARAMS.flatMap((key) => (typeof raw[key] === 'string' ? [[key, raw[key]]] : [])),
  );
  let preview;
  try {
    preview = await api('/v1/oauth/authorization/describe', {
      method: 'POST',
      body: params,
      schema: OAuthAuthorizationPreview,
      anonymous: true,
    });
  } catch (error) {
    // Invalid client or redirect URI: never redirect anywhere, explain instead.
    return (
      <div className="stack narrower">
        <h1>Cannot connect this application</h1>
        <p className="notice">
          {error instanceof ApiError ? error.message : 'The authorization request is invalid.'} Start the
          connection again from your AI application.
        </p>
      </div>
    );
  }

  const me = await currentUser();
  if (!me) {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }

  return (
    <div className="stack narrower">
      <h1>Connect an AI application</h1>
      <div className="card stack">
        <p>
          <strong className="untrusted">{preview.clientName}</strong>{' '}
          <span className="small muted">(name provided by the application, not verified by ATX)</span> wants
          to access the Automotive Technology Exchange as <strong>{me.user.displayName}</strong>.
        </p>
        <div>
          It will be able to:
          <ul>
            {preview.scopes.map((scope) => (
              <li key={scope}>{describeScope(scope)}</li>
            ))}
          </ul>
        </div>
        <p className="small muted">
          After you allow access you will be sent back to <code>{preview.redirectOrigin}</code>. Publishing
          content, sending requests and sharing private information still need your explicit approval each
          time. You can disconnect the application at any time on your account page.
        </p>
      </div>
      <ConsentForm params={params} />
    </div>
  );
}

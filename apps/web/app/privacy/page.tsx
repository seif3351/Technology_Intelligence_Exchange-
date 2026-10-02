import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy notice' };
export default function PrivacyPage() {
  return (
    <article className="stack narrow">
      <h1>Privacy notice (pilot)</h1>
      <p className="notice">
        DRAFT — describes the data the pilot processes. Replace with a notice approved by the operator&apos;s
        data-protection officer before external users are invited.
      </p>
      <h2>Data we process</h2>
      <ul>
        <li>Account data: name, work email, password hash, organization memberships and roles.</li>
        <li>Content you create: offerings, claims, evidence, uploaded documents, requirements, requests.</li>
        <li>
          Security records: an audit log of sensitive actions and short-lived technical logs. Passwords,
          access tokens and document contents are never written to logs.
        </li>
      </ul>
      <h2>Purposes</h2>
      <p>Operating the exchange, securing it, and showing published supplier content to other users.</p>
      <h2>Sharing</h2>
      <p>
        Published supplier content is visible to signed-in and anonymous visitors. Private requirements are
        never shown to suppliers. A buyer&apos;s contact details are shared with a supplier only when the
        buyer confirms a request. When AI features are enabled, supplier documents and redacted requirement
        text may be processed by the configured AI provider; confidential terms are removed first.
      </p>
      <h2>Cookies</h2>
      <p>One strictly necessary session cookie (httpOnly, secure). No tracking or advertising cookies.</p>
    </article>
  );
}

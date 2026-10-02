import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of use' };
export default function TermsPage() {
  return (
    <article className="stack narrow">
      <h1>Terms of use (pilot)</h1>
      <p className="notice">
        DRAFT — this page summarizes how the pilot works. It must be replaced by terms approved by the
        operator&apos;s legal counsel before external users are invited.
      </p>
      <h2>What the exchange is</h2>
      <p>
        A technical discovery network. It helps organizations find and evaluate automotive technologies. It is
        not a procurement, contracting or payment system, and nothing on it is an offer or a commitment.
      </p>
      <h2>Supplier content</h2>
      <ul>
        <li>
          Suppliers are responsible for the accuracy of what they publish and must hold the rights to it. They
          grant the operator the right to store, index and display published content to other users.
        </li>
        <li>
          Statements are shown with their provenance (for example “stated by supplier”). They are not
          endorsements; “verified by platform” only means the operator reviewed the linked evidence.
        </li>
        <li>No confidential customer or program information, and no instructions aimed at AI agents.</li>
      </ul>
      <h2>Buyer information</h2>
      <p>
        Private requirements stay inside the buyer&apos;s organization. Information is shared with a supplier
        only when a buyer explicitly confirms a request that shows exactly what will be shared.
      </p>
      <h2>Acceptable use</h2>
      <p>
        No scraping, no automated access except through the provided APIs and MCP server with your own
        credentials, no attempts to access other organizations&apos; data.
      </p>
    </article>
  );
}

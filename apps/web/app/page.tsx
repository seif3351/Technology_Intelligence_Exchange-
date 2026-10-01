import Link from 'next/link';

const EXAMPLES = [
  'I need an AUTOSAR Adaptive middleware solution for QNX and NVIDIA Orin with SOME/IP support.',
  'We need AI-based integration test automation for an ADAS platform using AUTOSAR Adaptive, QNX and Ethernet. We want a supplier with ISO 26262 experience and production references.',
  'Find suppliers with ISO 26262 experience.',
  'Scenario-based ADAS simulation with OpenSCENARIO, ideally with HIL support.',
];

export default function HomePage() {
  return (
    <div className="stack">
      <h1>Find automotive technologies that meet your technical requirements</h1>
      <p className="muted">
        Describe what you need. We interpret it into hard constraints and preferences, check every candidate against published technical claims,
        and show what is verified, what is only stated by the supplier, and what is unknown.
      </p>
      <form action="/search" className="search-box">
        <textarea name="q" aria-label="Technical requirement" placeholder="e.g. AUTOSAR Adaptive middleware for QNX on NVIDIA Orin with SOME/IP" required />
        <button type="submit" className="primary">
          Find matches
        </button>
      </form>
      <h2>Examples</h2>
      <ul>
        {EXAMPLES.map((example) => (
          <li key={example}>
            <Link href={`/search?q=${encodeURIComponent(example)}`}>{example}</Link>
          </li>
        ))}
      </ul>
      <h2>Using an AI assistant?</h2>
      <p>
        Connect your agent to the <Link href="/docs/mcp">Automotive Technology Exchange MCP server</Link> to run the same evidence-backed matching from
        your existing AI environment.
      </p>
    </div>
  );
}

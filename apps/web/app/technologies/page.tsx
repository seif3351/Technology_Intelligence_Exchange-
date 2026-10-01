import { Technology } from '@atx/contracts';
import Link from 'next/link';
import { z } from 'zod';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function TechnologiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { items } = await api(`/v1/technologies?limit=50${q ? `&query=${encodeURIComponent(q)}` : ''}`, {
    schema: z.object({ items: z.array(Technology) }),
    anonymous: true,
  });
  return (
    <div className="stack">
      <h1>Technology ontology</h1>
      <p className="muted">
        Concepts, aliases and relations used for matching. The ontology is data-driven and intentionally
        incomplete.
      </p>
      <form action="/technologies" className="search-box">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="e.g. Orin, SOME/IP, ISO 26262"
          aria-label="Technology"
        />
        <button type="submit">Search</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Concept</th>
            <th>Facet</th>
            <th>Aliases</th>
            <th>Relations</th>
            <th>Offerings</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>
                <strong>{t.label}</strong>
                <div className="small muted">{t.description}</div>
              </td>
              <td className="small">{t.facet}</td>
              <td className="small">{t.aliases.join(', ')}</td>
              <td className="small">
                {t.broader.length ? <div>is a: {t.broader.map((c) => c.label).join(', ')}</div> : null}
                {t.narrower.length ? <div>narrower: {t.narrower.map((c) => c.label).join(', ')}</div> : null}
                {t.related.length ? (
                  <div>
                    related:{' '}
                    {t.related.map((c) => `${c.label} (${c.relation.replace('inverse_', '')})`).join(', ')}
                  </div>
                ) : null}
              </td>
              <td>
                <Link href={`/search?q=${encodeURIComponent(t.label)}`}>{t.publishedOfferingCount}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { Technology } from '@atx/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { TableScroll } from '@/components/table-scroll';
import { api } from '@/lib/api';
import { getOntology } from '@/lib/ontology';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Technologies' };

type TechnologyT = z.infer<typeof Technology>;

const TechnologyTable = ({ items, label }: { items: readonly TechnologyT[]; label: string }) => (
  <TableScroll label={label}>
    <table>
      <thead>
        <tr>
          <th>Concept</th>
          <th>Also known as</th>
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
            <td className="small">{t.aliases.join(', ')}</td>
            <td className="small">
              {t.broader.length ? <div>is a: {t.broader.map((c) => c.label).join(', ')}</div> : null}
              {t.narrower.length ? <div>includes: {t.narrower.map((c) => c.label).join(', ')}</div> : null}
              {t.related.length ? (
                <div>
                  related:{' '}
                  {t.related.map((c) => `${c.label} (${c.relation.replace('inverse_', '')})`).join(', ')}
                </div>
              ) : null}
            </td>
            <td>
              {t.publishedOfferingCount > 0 ? (
                <Link
                  href={`/search?q=${encodeURIComponent(t.label)}`}
                  aria-label={`Search offerings for ${t.label}`}
                >
                  {t.publishedOfferingCount}
                </Link>
              ) : (
                <span className="muted">0</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </TableScroll>
);

export default async function TechnologiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q?.trim() ?? '';
  const [{ items }, ontology] = await Promise.all([
    api(`/v1/technologies?limit=${query ? 50 : 500}${query ? `&query=${encodeURIComponent(query)}` : ''}`, {
      schema: z.object({ items: z.array(Technology) }),
      anonymous: true,
    }),
    getOntology(),
  ]);
  const facets = [...ontology.facets]
    .map((facet) => ({ ...facet, items: items.filter((t) => t.facet === facet.id) }))
    .filter((facet) => facet.items.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="stack">
      <h1>Technologies</h1>
      <p className="muted">
        The {ontology.concepts.length} technologies, standards and capabilities that matching understands,
        grouped by kind. Aliases are recognized in requirements; a claim about a narrower technology also
        satisfies a broader one. The ontology is data-driven and intentionally incomplete.
      </p>
      <form action="/technologies" className="search-box">
        <input
          name="q"
          defaultValue={query}
          placeholder="e.g. Orin, SOME/IP, ISO 26262"
          aria-label="Find a technology"
        />
        <button type="submit">Find</button>
      </form>
      {query ? (
        <>
          <p className="small">
            {items.length} result{items.length === 1 ? '' : 's'} for “{query}” ·{' '}
            <Link href="/technologies">Show all</Link>
          </p>
          <TechnologyTable items={items} label={`Technologies matching ${query}`} />
        </>
      ) : (
        <>
          <nav aria-label="Kinds of technology" className="chips">
            {facets.map((facet) => (
              <a key={facet.id} className="badge" href={`#${facet.id}`}>
                {facet.label} ({facet.items.length})
              </a>
            ))}
          </nav>
          {facets.map((facet) => (
            <section key={facet.id} id={facet.id} className="stack">
              <h2>{facet.label}</h2>
              <p className="small muted flush">{facet.description}</p>
              <TechnologyTable items={facet.items} label={facet.label} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}

import type { McpMatch, McpTools } from '@atx/contracts';
import type { z } from 'zod';
import { badge, demoBadge, h, statusChip, verificationBadge } from './dom';

/**
 * Pure renderers from structured tool results to DOM. They contain no
 * business logic: every status, basis and score comes from the server.
 */
type Out<K extends keyof typeof McpTools> = z.infer<(typeof McpTools)[K]['output']>;
type Match = z.infer<typeof McpMatch>;

export interface ViewActions {
  openLink(url: string): void;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ structuredContent?: unknown; isError?: boolean; text?: string }>;
}

const link = (actions: ViewActions, url: string | null, label: string) =>
  url ? h('button', { type: 'button', onclick: () => actions.openLink(url) }, label) : null;

const notice = (text: string) => h('p', { class: 'notice' }, text);

export const renderMatch = (match: Match, actions: ViewActions) =>
  h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row' },
      h('strong', {}, `${match.rank}. ${match.offering.name}`),
      h('span', { class: 'muted' }, match.offering.supplier.name),
      verificationBadge(match.offering.supplier.verificationState),
      demoBadge(match.offering.isDemo),
    ),
    h('div', { class: 'muted' }, `${match.summary} Confidence: ${match.confidence}.`),
    h(
      'table',
      {},
      h('tr', {}, h('th', {}, 'Constraint'), h('th', {}, 'Status'), h('th', {}, 'Basis')),
      ...match.assessments.map((a) =>
        h(
          'tr',
          {},
          h(
            'td',
            {},
            a.description,
            a.priority === 'preference' ? h('span', { class: 'muted' }, ' (preference)') : null,
          ),
          h('td', {}, statusChip(a.status, a.explanation)),
          h('td', { class: 'muted' }, a.basis ?? '—'),
        ),
      ),
    ),
    match.gaps.length > 0
      ? h(
          'details',
          {},
          h('summary', {}, `${match.gaps.length} open question(s) for the supplier`),
          h('ul', {}, ...match.gaps.map((g) => h('li', {}, g.suggestedQuestion))),
        )
      : null,
    h(
      'details',
      {},
      h('summary', { class: 'muted' }, `Score ${match.score} — how it is calculated`),
      h(
        'ul',
        {},
        ...match.scoreBreakdown.map((s) => h('li', {}, `${s.name}: ${s.value} × weight ${s.weight}`)),
      ),
    ),
    h('div', { class: 'row' }, link(actions, match.offering.url, 'Open profile')),
  );

export const renderMatches = (data: Out<'find_matching_offerings'>, actions: ViewActions) =>
  h(
    'div',
    {},
    h('h1', {}, 'Compatibility matrix'),
    h(
      'div',
      { class: 'muted' },
      `Hard constraints: ${data.interpretation.hardConstraints.map((c) => c.description).join('; ') || 'none'}`,
    ),
    data.interpretation.unknownTerms.length > 0
      ? h('div', { class: 'muted' }, `Not in ontology: ${data.interpretation.unknownTerms.join(', ')}`)
      : null,
    h('h2', {}, `${data.matches.length} candidate(s)`),
    ...data.matches.map((match) => renderMatch(match, actions)),
    notice(data.notice),
  );

export const renderExplain = (data: Out<'explain_match'>, actions: ViewActions) =>
  h('div', {}, h('h1', {}, 'Match explanation'), renderMatch(data.match, actions), notice(data.notice));

export const renderOffering = (data: Out<'get_offering'>, actions: ViewActions) => {
  const o = data.offering;
  const claimRow = (c: Out<'get_offering'>['claims'][number]) =>
    h(
      'tr',
      {},
      h('td', {}, c.concept.label),
      h('td', {}, c.predicate),
      h('td', { class: 'untrusted' }, c.statement),
      h('td', { class: 'muted' }, c.trust),
    );
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'row' },
      h('h1', {}, o.name),
      badge(o.maturity),
      verificationBadge(o.supplier.verificationState),
      demoBadge(o.isDemo),
    ),
    h('div', { class: 'muted' }, `${o.supplier.name} · ${o.type}`),
    h('p', { class: 'untrusted' }, o.summary),
    h('h2', {}, 'Technical claims'),
    h(
      'table',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Technology'),
        h('th', {}, 'Claim'),
        h('th', {}, 'Statement (supplier)'),
        h('th', {}, 'Basis'),
      ),
      ...data.claims.map(claimRow),
    ),
    data.organizationClaims.length > 0
      ? h(
          'div',
          {},
          h('h2', {}, 'Organization-level claims'),
          h('table', {}, ...data.organizationClaims.map(claimRow)),
        )
      : null,
    data.videos.length > 0
      ? h(
          'div',
          {},
          h('h2', {}, 'Demos'),
          ...data.videos.map((v) =>
            h(
              'div',
              { class: 'row' },
              h('span', {}, v.title),
              link(actions, v.playbackUrl ?? v.pageUrl, 'Watch'),
            ),
          ),
        )
      : null,
    h('div', { class: 'row' }, link(actions, o.url, 'Open full profile')),
    notice(data.notice),
  );
};

export const renderComparison = (data: Out<'compare_offerings'>, actions: ViewActions) =>
  h(
    'div',
    {},
    h('h1', {}, 'Side-by-side comparison'),
    h(
      'table',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Constraint'),
        ...data.offerings.map((o) =>
          h('th', {}, h('button', { type: 'button', onclick: () => actions.openLink(o.url) }, o.name)),
        ),
      ),
      ...data.rows.map((row) =>
        h(
          'tr',
          {},
          h(
            'td',
            {},
            row.description,
            row.priority === 'preference' ? h('span', { class: 'muted' }, ' (pref.)') : null,
          ),
          ...row.cells.map((cell) => h('td', {}, statusChip(cell.status, cell.basis))),
        ),
      ),
    ),
    notice(data.notice),
  );

export const renderVideos = (data: Out<'get_demo'>, actions: ViewActions) =>
  h(
    'div',
    {},
    h('h1', {}, 'Technical demos'),
    ...(data.videos.length === 0 ? [h('p', { class: 'muted' }, 'No demo videos found.')] : []),
    ...data.videos.map((v) =>
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'row' },
          h('strong', {}, v.title),
          v.offeringName ? h('span', { class: 'muted' }, v.offeringName) : null,
          v.durationSeconds ? badge(`${Math.round(v.durationSeconds / 60)} min`) : null,
        ),
        h('p', { class: 'untrusted muted' }, v.description),
        // Media only loads when the host's CSP allows its origin; otherwise the link remains.
        v.playbackUrl && /\.(mp4|webm)(\?|$)/.test(v.playbackUrl)
          ? h('video', { controls: true, preload: 'none', src: v.playbackUrl })
          : null,
        h(
          'div',
          { class: 'row' },
          link(actions, v.playbackUrl, 'Open video'),
          link(actions, v.pageUrl, 'Offering profile'),
        ),
      ),
    ),
    notice(data.notice),
  );

export const renderEvidence = (data: Out<'get_evidence'>, actions: ViewActions) =>
  h(
    'div',
    {},
    h('h1', {}, 'Evidence & provenance'),
    h(
      'table',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Claim'),
        h('th', {}, 'Provenance'),
        h('th', {}, 'Basis'),
        h('th', {}, 'Evidence'),
      ),
      ...data.claims.map((c) =>
        h(
          'tr',
          {},
          h('td', {}, `${c.predicate} ${c.concept.label}`),
          h('td', {}, c.provenance),
          h('td', { class: 'muted' }, c.trust),
          h('td', {}, String(c.evidenceIds.length)),
        ),
      ),
    ),
    h('h2', {}, 'Evidence items'),
    ...data.evidence.map((e) =>
      h(
        'div',
        { class: 'row' },
        badge(e.kind),
        h('span', { class: 'untrusted' }, e.title),
        link(actions, e.url, 'Open'),
      ),
    ),
    notice(data.notice),
  );

export const renderInterpretation = (data: Out<'analyze_requirement'>, actions: ViewActions) => {
  const interpretation = data.interpretation;
  const results = h('div', {});
  const constraints = [...interpretation.hardConstraints, ...interpretation.preferences].map((c) => ({
    ...c,
    include: true,
  }));
  const list = h(
    'table',
    {},
    h('tr', {}, h('th', {}, 'Use'), h('th', {}, 'Constraint'), h('th', {}, 'Priority')),
    ...constraints.map((c) =>
      h(
        'tr',
        {},
        h(
          'td',
          {},
          h('input', {
            type: 'checkbox',
            checked: true,
            onchange: (event: Event) => (c.include = (event.target as HTMLInputElement).checked),
          }),
        ),
        h('td', {}, c.description),
        h('td', {}, c.priority),
      ),
    ),
  );
  const search = async () => {
    results.replaceChildren(h('p', { class: 'muted' }, 'Matching…'));
    const selected = constraints.filter((c) => c.include);
    const payload = selected.map((c) =>
      c.kind === 'concept' && c.conceptId
        ? { kind: 'concept', conceptId: c.conceptId, level: c.level ?? 'supports', priority: c.priority }
        : c.kind === 'maturity'
          ? { kind: 'maturity', minimum: 'production', priority: c.priority }
          : { kind: 'production_reference', priority: c.priority },
    );
    const response = await actions.callTool('find_matching_offerings', { constraints: payload, limit: 5 });
    results.replaceChildren(
      response.isError || !response.structuredContent
        ? h('p', {}, response.text ?? 'Matching failed.')
        : renderMatches(response.structuredContent as Out<'find_matching_offerings'>, actions),
    );
  };
  return h(
    'div',
    {},
    h('h1', {}, 'Requirement builder'),
    list,
    interpretation.unknownTerms.length > 0
      ? h(
          'p',
          { class: 'muted' },
          `Not in ontology (text search only): ${interpretation.unknownTerms.join(', ')}`,
        )
      : null,
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        { class: 'primary', type: 'button', onclick: () => void search() },
        'Find matching offerings',
      ),
    ),
    results,
  );
};

export const renderRequirementDraft = (data: Out<'create_requirement_draft'>, actions: ViewActions) =>
  h(
    'div',
    {},
    h(
      'div',
      { class: 'row' },
      h('h1', {}, 'Private requirement saved'),
      badge(data.requirement.visibility, 'good'),
    ),
    h('p', {}, data.requirement.title),
    h(
      'p',
      { class: 'muted' },
      `${data.requirement.confidentialTermCount} confidential term(s) protected — never shown to suppliers.`,
    ),
    h('ul', {}, ...data.constraints.map((c) => h('li', {}, `${c.description} (${c.priority})`))),
    ...data.issues.map((i) => h('p', { class: 'muted' }, `${i.severity}: ${i.message}`)),
    h('div', { class: 'row' }, link(actions, data.requirement.url, 'Open in workspace')),
  );

/**
 * Human approval happens HERE: the request is only sent when the user ticks
 * the approval box and presses the button in the host UI.
 */
export const renderRequestForm = (
  data: Out<'prepare_engagement_request'>,
  input: Record<string, unknown> | null,
  actions: ViewActions,
) => {
  const preview = data.preview as {
    type?: string;
    recipient?: { supplierName?: string; offeringName?: string };
    willBeShared?: {
      buyerOrganizationName?: string;
      contactName?: string;
      contactEmail?: string;
      message?: string;
      disclosedSummary?: string | null;
      constraints?: { description: string }[];
    };
    willNotBeShared?: string[];
  };
  const status = h('p', { class: 'muted' });
  const approve = h('input', { type: 'checkbox', id: 'approve' }) as HTMLInputElement;
  const send = h(
    'button',
    { class: 'primary', type: 'button', disabled: true },
    'Send request',
  ) as HTMLButtonElement;
  approve.addEventListener('change', () => (send.disabled = !approve.checked || !input));
  send.addEventListener('click', async () => {
    if (!input) return;
    send.disabled = true;
    status.textContent = 'Sending…';
    const response = await actions.callTool('confirm_engagement_request', {
      ...input,
      confirmation_token: data.confirmationToken,
      idempotency_key: crypto.randomUUID(),
      user_confirmed: true,
    });
    status.textContent = response.isError
      ? (response.text ?? 'Request failed.')
      : 'Request sent to the supplier.';
  });
  const shared = preview.willBeShared ?? {};
  return h(
    'div',
    {},
    h('h1', {}, `Review ${preview.type ?? ''} request — not sent yet`),
    h('p', {}, `To: ${preview.recipient?.supplierName ?? ''} (${preview.recipient?.offeringName ?? ''})`),
    h('h2', {}, 'Will be shared'),
    h(
      'ul',
      {},
      h('li', {}, `Organization: ${shared.buyerOrganizationName ?? ''}`),
      h('li', {}, `Contact: ${shared.contactName ?? ''} <${shared.contactEmail ?? ''}>`),
      h('li', {}, `Message: ${shared.message ?? ''}`),
      shared.disclosedSummary ? h('li', {}, `Summary: ${shared.disclosedSummary}`) : null,
      h(
        'li',
        {},
        `Constraints: ${(shared.constraints ?? []).map((c) => c.description).join('; ') || 'none'}`,
      ),
    ),
    h('h2', {}, 'Will NOT be shared'),
    h('ul', {}, ...(preview.willNotBeShared ?? []).map((item) => h('li', {}, item))),
    h(
      'div',
      { class: 'row' },
      approve,
      h('label', { for: 'approve' }, 'I approve sending exactly this information'),
    ),
    h('div', { class: 'row' }, send),
    status,
    h('p', { class: 'notice' }, `Expires ${data.expiresAt}.`),
  );
};

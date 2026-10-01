/**
 * Minimal, XSS-safe DOM builder. Text is always set via textContent; there is
 * deliberately no way to inject HTML. Supplier content is untrusted.
 */
type Child = Node | string | number | null | undefined | false;

export const h = (tag: string, attrs: Record<string, string | boolean | ((event: Event) => void)> = {}, ...children: Child[]): HTMLElement => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') element.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) element.setAttribute(key, '');
    else if (value !== false) element.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return element;
};

export const STATUS_LABEL: Record<string, string> = { met: 'Met', partial: 'Partial', unknown: 'Unknown', unmet: 'Not met' };

export const statusChip = (status: string, title?: string | null) =>
  h('span', { class: `chip chip-${status}`, title: title ?? STATUS_LABEL[status] ?? status }, STATUS_LABEL[status] ?? status);

export const badge = (text: string, kind = 'neutral') => h('span', { class: `badge badge-${kind}` }, text);

export const verificationBadge = (state: string) =>
  badge(state === 'verified' ? 'Verified supplier' : state === 'pending' ? 'Verification pending' : 'Unverified supplier', state === 'verified' ? 'good' : 'warn');

export const demoBadge = (isDemo: boolean) => (isDemo ? badge('Demo data', 'demo') : null);

/**
 * Wraps a table so it scrolls inside its own box on narrow screens instead of
 * widening the page. Focusable and labelled, so keyboard users can scroll it.
 */
export const TableScroll = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
    {children}
  </div>
);

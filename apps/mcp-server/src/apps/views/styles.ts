export const STYLES = `
:root { --fg:#1b1f24; --muted:#5b6470; --line:#d9dee4; --bg:#ffffff; --panel:#f6f8fa; --accent:#1f5fae;
  --met:#1e7f3d; --partial:#9a6700; --unknown:#5b6470; --unmet:#b42318; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) { :root { --fg:#e6e9ed; --muted:#9aa4ae; --line:#30363d; --bg:#0d1117; --panel:#161b22; --accent:#6ea8fe;
  --met:#4ac26b; --partial:#d4a72c; --unknown:#9aa4ae; --unmet:#f47067; } }
body { margin:0; padding:12px; color:var(--fg); background:var(--bg); }
h1 { font-size:15px; margin:0 0 4px; } h2 { font-size:13px; margin:14px 0 6px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
.muted { color:var(--muted); } .row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.card { border:1px solid var(--line); border-radius:6px; padding:10px; margin-bottom:8px; background:var(--panel); }
table { border-collapse:collapse; width:100%; } th, td { border-bottom:1px solid var(--line); padding:4px 6px; text-align:left; vertical-align:top; }
th { font-weight:600; color:var(--muted); font-size:12px; }
.chip { display:inline-block; padding:1px 6px; border-radius:10px; font-size:11px; font-weight:600; border:1px solid currentColor; }
.chip-met { color:var(--met); } .chip-partial { color:var(--partial); } .chip-unknown { color:var(--unknown); } .chip-unmet { color:var(--unmet); }
.badge { display:inline-block; padding:1px 6px; border-radius:4px; font-size:11px; background:var(--bg); border:1px solid var(--line); }
.badge-good { color:var(--met); } .badge-warn { color:var(--partial); } .badge-demo { color:var(--accent); }
.untrusted { border-left:3px solid var(--line); padding-left:6px; }
button { font:inherit; padding:4px 10px; border:1px solid var(--line); border-radius:4px; background:var(--bg); color:var(--fg); cursor:pointer; }
button.primary { background:var(--accent); color:#fff; border-color:var(--accent); } button:disabled { opacity:.5; cursor:not-allowed; }
video { width:100%; max-height:280px; background:#000; border-radius:4px; }
.notice { font-size:11px; color:var(--muted); margin-top:10px; }
`;

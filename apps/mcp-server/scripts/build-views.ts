/**
 * Bundles the MCP App views into self-contained HTML files (one per ui://
 * resource). Each file inlines the same script bundle and selects its view
 * via window.ATX_VIEW, so web and MCP Apps never fork business logic.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../dist/views');
const VIEWS = [
  'offering-card',
  'compatibility-matrix',
  'video-player',
  'comparison',
  'requirement-builder',
  'evidence-viewer',
  'request-form',
];

const result = await build({
  entryPoints: [path.resolve(here, '../src/apps/views/main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
});
const script = result.outputFiles[0]?.text ?? '';
if (!script) throw new Error('View bundle is empty');
// Guard against "</script>" sequences inside the inlined bundle.
const safeScript = script.replace(/<\/script/gi, '<\\/script');

await mkdir(outDir, { recursive: true });
for (const view of VIEWS) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ATX ${view}</title></head><body><script>window.ATX_VIEW=${JSON.stringify(view)};</script><script type="module">${safeScript}</script></body></html>`;
  await writeFile(path.join(outDir, `${view}.html`), html);
}
console.log(`built ${VIEWS.length} views (${Math.round(script.length / 1024)} KiB bundle) -> ${outDir}`);

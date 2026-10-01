import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { UI } from '../tools/discovery';

export const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/views');

/** Loads the bundled MCP App views (built by `pnpm build:views`). */
export const loadViews = (directory = VIEWS_DIR): Map<string, string> => {
  const views = new Map<string, string>();
  for (const uri of Object.values(UI)) {
    const file = path.join(directory, uri.replace('ui://atx/', ''));
    if (existsSync(file)) views.set(uri, readFileSync(file, 'utf8'));
  }
  return views;
};

/**
 * Registers the ui:// resources. Views render only data from tool results
 * (no network access by default); media may load from the API origin (signed
 * asset URLs) and explicitly configured video hosts.
 */
export const registerViews = (
  server: McpServer,
  views: ReadonlyMap<string, string>,
  mediaOrigins: readonly string[],
): void => {
  for (const [uri, html] of views) {
    registerAppResource(
      server,
      uri.replace('ui://atx/', 'ATX '),
      uri,
      { description: 'Automotive Technology Exchange view' },
      async () => ({
        contents: [
          {
            uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: { csp: { resourceDomains: [...mediaOrigins], connectDomains: [] }, prefersBorder: true },
            },
          },
        ],
      }),
    );
  }
};

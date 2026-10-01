import 'server-only';

/** Web BFF configuration. The browser never talks to the API directly. */
export const webConfig = {
  apiUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
  mcpUrl: process.env.MCP_PUBLIC_URL ?? 'http://localhost:4100/mcp',
  secureCookies: process.env.NODE_ENV === 'production',
};

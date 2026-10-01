import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * E2E runs against a freshly seeded database so journeys are repeatable.
 * WARNING: this resets the database configured by DATABASE_URL (local dev DB
 * by default). Set E2E_SKIP_DB_RESET=1 to keep existing data.
 */
export default function globalSetup(): void {
  if (process.env['E2E_SKIP_DB_RESET'] === '1') return;
  execSync('pnpm db:reset', { cwd: path.resolve(import.meta.dirname, '../../..'), stdio: 'inherit' });
}

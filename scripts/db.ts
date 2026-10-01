/**
 * Database lifecycle commands:
 *   tsx scripts/db.ts migrate   apply pending migrations
 *   tsx scripts/db.ts seed      migrate + load ontology + synthetic demo data (non-production only)
 *   tsx scripts/db.ts reset     drop and recreate the public schema, then seed (development/test only)
 */
import path from 'node:path';
import { loadConfig } from '@atx/config';
import { migrate } from '@atx/infrastructure';
import { createRuntime, seedDemoData, seedOntology } from '@atx/runtime';

const ROOT = path.resolve(import.meta.dirname, '..');

const main = async () => {
  const command = process.argv[2];
  const env = loadConfig();
  const runtime = await createRuntime(env, 'atx-db');
  try {
    if (command === 'reset') {
      if (env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
      await runtime.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    const applied = await migrate(runtime.pool);
    console.log(`migrations applied: ${applied.length ? applied.join(', ') : 'none pending'}`);
    if (command === 'seed' || command === 'reset') {
      await seedOntology(runtime, path.join(ROOT, 'data/ontology'));
      console.log('ontology loaded');
      if (env.NODE_ENV === 'production') {
        console.log('production: synthetic demo data is not loaded');
      } else {
        const counts = await seedDemoData(runtime, path.join(ROOT, 'data/seed/demo.yaml'));
        console.log(`demo data: ${JSON.stringify(counts)} (DEMO/SYNTHETIC)`);
      }
    } else if (command !== 'migrate') {
      throw new Error(`Unknown command "${command}". Use migrate | seed | reset.`);
    }
  } finally {
    await runtime.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

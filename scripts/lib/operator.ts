import { loadConfig } from '@atx/config';
import { createRuntime, type Runtime } from '@atx/runtime';

/** Operator commands act as the system principal; every use case they call is audited as `admin-cli`. */
export const OPERATOR_CONTEXT = {
  principal: { kind: 'system', component: 'admin-cli' },
  requestId: 'admin-cli',
} as const;

/**
 * Runs one operator command against the configured database and always
 * closes the runtime. Failures print the message only (no stack trace, no
 * values) and set a non-zero exit code.
 */
export const runOperatorCommand = async (command: (runtime: Runtime) => Promise<void>): Promise<void> => {
  const runtime = await createRuntime(loadConfig(), 'atx-admin-cli');
  try {
    await command(runtime);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
};

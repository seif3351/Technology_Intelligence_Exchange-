import pg from 'pg';

/** Anything that can run a parameterized query: the pool or a transaction client. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: readonly unknown[]): Promise<pg.QueryResult<R>>;
}

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
}

export const createPool = (options: DatabaseOptions): pg.Pool => {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'atx',
  });
  // Without a listener an idle-client error would crash the process.
  pool.on('error', () => undefined);
  return pool;
};

export const withTransaction = async <T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

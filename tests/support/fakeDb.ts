/**
 * A fake SQL executor that records exactly how statements are run, so the
 * input-safety BDD suite can prove values are bound as parameters and never
 * concatenated into the SQL string.
 */
import { SqlExecutor } from '../../src/db/sql';

interface RunCall {
  sql: string;
  params: Array<string | number | null>;
}

export class FakeDb implements SqlExecutor {
  public calls: RunCall[] = [];
  public rows: Array<Record<string, unknown>> = [];

  async run(sql: string, params: Array<string | number | null>): Promise<void> {
    this.calls.push({ sql, params });
    // Simulate a prepared-statement engine binding params positionally.
    // (No string interpolation ever happens.)
    this.rows.push({ sql, params });
  }

  get last(): RunCall {
    const call = this.calls[this.calls.length - 1];
    if (!call) throw new Error('No statements were run');
    return call;
  }
}

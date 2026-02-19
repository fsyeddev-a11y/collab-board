/**
 * BoardRoom Durable Object — unit tests
 *
 * @cloudflare/vitest-pool-workers runs these tests inside the actual Workerd
 * runtime, so `env.BOARD_ROOM` is a real DurableObjectNamespace backed by the
 * bindings declared in wrangler.test.toml — no mocking required for the DO layer.
 *
 * Test strategy
 * ─────────────
 * JWT verification (Clerk) sits at the WebSocket connect layer, so the tests
 * work one level below that: they trigger DO initialisation via a plain HTTP
 * request (which returns 400 "Expected WebSocket" but fully runs the
 * constructor and blockConcurrencyWhile), then use `runInDurableObject` to
 * inspect and exercise the internal state directly.
 */

import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { BoardRoom } from '../durable-objects/BoardRoom';
import type { Env } from '../index';

// Tell TypeScript what bindings are available on `env` in this test file.
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

// Shorthand for the SQL row type returned by state.storage.sql.exec().toArray()
type SqlRow = Record<string, string | number | null | ArrayBuffer>;

// Helper — the first HTTP fetch to a DO stub triggers the constructor and
// blockConcurrencyWhile (which runs loadBoardState and creates the SQL table).
async function initialiseDO(name: string) {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(name));
  // A plain HTTP request is rejected (400 "Expected WebSocket") but the DO is
  // fully initialised by the time the response is returned.
  const response = await stub.fetch('http://do/');
  expect(response.status).toBe(400);
  return stub;
}

describe('BoardRoom Durable Object', () => {
  it('creates the board_records SQLite table on first initialisation', async () => {
    const stub = await initialiseDO('test-init');

    await runInDurableObject(stub, async (_instance: BoardRoom, state: DurableObjectState) => {
      const tables = state.storage.sql
        .exec(`SELECT name FROM sqlite_master WHERE type='table'`)
        .toArray() as SqlRow[];

      expect(tables.some((row) => row.name === 'board_records')).toBe(true);
    });
  });

  it('persists a record to SQLite when saveRecord is called', async () => {
    const stub = await initialiseDO('test-save');

    await runInDurableObject(stub, async (instance: BoardRoom, state: DurableObjectState) => {
      const record = {
        id: 'shape:test-abc',
        typeName: 'shape',
        x: 100,
        y: 200,
      };

      // saveRecord is private — cast to access it directly in the test.
      // This verifies the exact persistence path taken when the DO processes
      // an 'update' WebSocket message.
      type WithSaveRecord = { saveRecord: (id: string, r: unknown) => Promise<void> };
      await (instance as unknown as WithSaveRecord).saveRecord('shape:test-abc', record);

      const rows = state.storage.sql
        .exec(`SELECT id, data FROM board_records WHERE id='shape:test-abc'`)
        .toArray() as SqlRow[];

      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].data as string)).toMatchObject(record);
    });
  });

  it('loads persisted records back into boardState on reinitialisation', async () => {
    // This test verifies the hydration path: loadBoardState() correctly reads
    // persisted SQLite rows into the in-memory boardState map.
    //
    // Why a single runInDurableObject call:
    // Once runInDurableObject first touches a stub the DO is instantiated and
    // stays alive for the rest of the test run — there is no in-process eviction.
    // Two separate calls share the same live instance, so a second fetch would
    // NOT re-run loadBoardState(). Instead we stay inside one call, insert
    // records after construction, then invoke loadBoardState() directly — the
    // exact method called in blockConcurrencyWhile on every cold start.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('test-reload-real'));

    await runInDurableObject(stub, async (instance: BoardRoom, state: DurableObjectState) => {
      // At this point the constructor has already run with empty storage,
      // so boardState is empty. Insert two records to simulate previously
      // persisted board data.
      const now = Date.now();
      state.storage.sql.exec(
        `INSERT INTO board_records (id, type, data, updated_at) VALUES (?, ?, ?, ?)`,
        'shape:r1',
        'shape',
        JSON.stringify({ id: 'shape:r1', typeName: 'shape', x: 0, y: 0 }),
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO board_records (id, type, data, updated_at) VALUES (?, ?, ?, ?)`,
        'shape:r2',
        'shape',
        JSON.stringify({ id: 'shape:r2', typeName: 'shape', x: 50, y: 50 }),
        now,
      );

      // Simulate a cold-start reload by calling loadBoardState() directly.
      // This is the exact private method executed inside blockConcurrencyWhile
      // whenever the DO wakes up from eviction.
      type WithLoad = { loadBoardState: () => Promise<void> };
      await (instance as unknown as WithLoad).loadBoardState();

      // The in-memory boardState map must now contain both persisted records.
      type WithBoardState = { boardState: Map<string, unknown> };
      const boardState = (instance as unknown as WithBoardState).boardState;

      expect(boardState.has('shape:r1')).toBe(true);
      expect(boardState.has('shape:r2')).toBe(true);
    });
  });
});

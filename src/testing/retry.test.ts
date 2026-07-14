import assert from "node:assert/strict";
import test from "node:test";
import { retry } from "./retry";

test("retries transient failures with bounded backoff", async () => {
  const attempts: number[] = [];
  const retries: Array<{ next: number; total: number }> = [];
  const delays: number[] = [];

  const result = await retry(async (attempt) => {
    attempts.push(attempt);
    if (attempt < 3) throw new Error(`transient ${attempt}`);
    return "ok";
  }, {
    attempts: 3,
    delayMs: 10,
    onRetry: (_error, next, total) => retries.push({ next, total }),
    sleep: async (milliseconds) => { delays.push(milliseconds); },
  });

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(retries, [{ next: 2, total: 3 }, { next: 3, total: 3 }]);
  assert.deepEqual(delays, [10, 20]);
});

test("does not hide the final failure", async () => {
  const expected = new Error("permanent");
  let attempts = 0;
  await assert.rejects(
    retry(async () => {
      attempts += 1;
      throw expected;
    }, {
      attempts: 2,
      delayMs: 0,
      sleep: async () => undefined,
    }),
    (error) => error === expected,
  );
  assert.equal(attempts, 2);
});

test("rejects invalid retry limits", async () => {
  await assert.rejects(
    retry(async () => "unused", { attempts: 0, delayMs: 0 }),
    RangeError,
  );
});

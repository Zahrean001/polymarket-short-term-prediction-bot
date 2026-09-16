import test from "node:test";
import assert from "node:assert/strict";
import { AsyncResultCache } from "../server/settlement/asyncResultCache.js";

test("official settlement request cache deduplicates concurrent loads and expires", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new AsyncResultCache({ hitTtlMs: 100, missTtlMs: 20, now: () => now });
  const loader = async () => {
    loads += 1;
    await Promise.resolve();
    return { officialOutcome: "Up" };
  };
  const [first, second] = await Promise.all([
    cache.getOrLoad("slug", loader),
    cache.getOrLoad("slug", loader),
  ]);
  assert.equal(loads, 1);
  assert.deepEqual(first, second);
  await cache.getOrLoad("slug", loader);
  assert.equal(loads, 1);
  now += 101;
  await cache.getOrLoad("slug", loader);
  assert.equal(loads, 2);
});

test("official settlement misses use a short cache and retry", async () => {
  let now = 2_000;
  let loads = 0;
  const cache = new AsyncResultCache({ hitTtlMs: 100, missTtlMs: 20, now: () => now });
  const loader = async () => {
    loads += 1;
    return null;
  };
  assert.equal(await cache.getOrLoad("missing", loader), null);
  assert.equal(await cache.getOrLoad("missing", loader), null);
  assert.equal(loads, 1);
  now += 21;
  assert.equal(await cache.getOrLoad("missing", loader), null);
  assert.equal(loads, 2);
});

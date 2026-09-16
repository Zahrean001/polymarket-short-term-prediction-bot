import assert from "node:assert/strict";
import test from "node:test";
import {
  EligibilityEpisodeStore,
  advanceEligibilityEpisode,
  buildEligibilityEpisodeKey,
} from "../server/prediction/eligibilityEpisode.js";

function observation(overrides = {}) {
  return {
    key: "0|btc-updown-5m-1|UP",
    slug: "btc-updown-5m-1",
    side: "UP",
    nowMs: 1_000,
    bookGeneration: "100:1",
    chainlinkGeneration: "BTC:1000",
    independentAssetPolicyEligible: true,
    independentAssetPolicyReason: "independent_asset_net_edge_ready",
    assetProbability: 0.75,
    assetNetEdge: 0.05,
    calibratedNetEdge: -0.02,
    calibratedProbability: 0.60,
    bookConfirmationScore: -0.05,
    bookConfirmed: false,
    bookIntegrityOk: true,
    wsBook: true,
    chainlinkAgeMs: 100,
    bookAgeMs: 100,
    officialTarget: true,
    correlationIndex: 0,
    ...overrides,
  };
}

test("near-threshold asset evidence needs three books, two Chainlink events, and 400ms", () => {
  let state = null;
  let result;
  for (const [index, offset] of [0, 200, 400].entries()) {
    result = advanceEligibilityEpisode(state, observation({
      nowMs: 1_000 + offset,
      bookGeneration: `100:${index + 1}`,
      chainlinkGeneration: index < 2 ? "BTC:1000" : "BTC:1400",
    }));
    state = result.state;
  }
  assert.equal(result.decision.distinctSnapshots, 3);
  assert.equal(result.decision.distinctChainlinkEvents, 2);
  assert.equal(result.decision.durationMs, 400);
  assert.equal(result.decision.ready, true);
});

test("strong independent asset edge uses two books and two Chainlink events", () => {
  const first = advanceEligibilityEpisode(null, observation({ assetNetEdge: 0.08 }));
  const second = advanceEligibilityEpisode(first.state, observation({
    nowMs: 1_150,
    bookGeneration: "100:2",
    chainlinkGeneration: "BTC:1150",
    assetNetEdge: 0.08,
  }));
  assert.equal(second.decision.requirements.requiredSnapshots, 2);
  assert.equal(second.decision.requirements.requiredDurationMs, 150);
  assert.equal(second.decision.distinctChainlinkEvents, 2);
  assert.equal(second.decision.ready, true);
});

test("book confirmation is a commit-time gate and cannot prevent asset evidence from arming", () => {
  const first = advanceEligibilityEpisode(null, observation({ assetNetEdge: 0.09, bookConfirmed: false }));
  const second = advanceEligibilityEpisode(first.state, observation({
    nowMs: 1_200,
    bookGeneration: "100:2",
    chainlinkGeneration: "BTC:1200",
    assetNetEdge: 0.09,
    bookConfirmed: false,
  }));
  assert.equal(second.decision.ready, true);
});

test("repeated scans of one book and one Chainlink event never add evidence", () => {
  let state = advanceEligibilityEpisode(null, observation({ assetNetEdge: 0.08 })).state;
  for (let index = 1; index <= 20; index += 1) {
    state = advanceEligibilityEpisode(state, observation({
      nowMs: 1_000 + index * 50,
      bookGeneration: "100:1",
      chainlinkGeneration: "BTC:1000",
      assetNetEdge: 0.08,
    })).state;
  }
  assert.equal(state.distinctSnapshots, 1);
  assert.equal(state.distinctChainlinkEvents, 1);
  assert.equal(state.ready, false);
  assert.equal(state.duplicatesIgnored, 20);
});

test("new Chainlink events cannot impersonate distinct order-book revisions", () => {
  let state = advanceEligibilityEpisode(null, observation({ assetNetEdge: 0.08 })).state;
  state = advanceEligibilityEpisode(state, observation({
    nowMs: 1_200,
    bookGeneration: "100:1",
    chainlinkGeneration: "BTC:1200",
    assetNetEdge: 0.08,
  })).state;
  assert.equal(state.distinctSnapshots, 1);
  assert.equal(state.distinctChainlinkEvents, 2);
  assert.equal(state.ready, false);
});

test("duplicate scan spam cannot keep stale economic evidence alive", () => {
  let state = advanceEligibilityEpisode(null, observation({ assetNetEdge: 0.08 })).state;
  for (let nowMs = 1_500; nowMs <= 10_000; nowMs += 500) {
    state = advanceEligibilityEpisode(state, observation({
      nowMs,
      bookGeneration: "100:1",
      chainlinkGeneration: "BTC:1000",
      assetNetEdge: 0.08,
    })).state;
  }
  const nextDistinct = advanceEligibilityEpisode(state, observation({
    nowMs: 10_150,
    bookGeneration: "100:2",
    chainlinkGeneration: "BTC:10150",
    assetNetEdge: 0.08,
  }));
  assert.equal(nextDistinct.decision.transition, "restart_after_gap");
  assert.equal(nextDistinct.decision.distinctSnapshots, 1);
  assert.equal(nextDistinct.decision.ready, false);
});

test("calibrated edge may cross once after stable asset evidence; final calibration still gates commit", () => {
  const first = advanceEligibilityEpisode(null, observation({
    assetNetEdge: 0.09,
    calibratedNetEdge: -0.03,
  }));
  const second = advanceEligibilityEpisode(first.state, observation({
    nowMs: 1_200,
    bookGeneration: "100:2",
    chainlinkGeneration: "BTC:1200",
    assetNetEdge: 0.09,
    calibratedNetEdge: 0.08,
    bookConfirmed: true,
  }));
  assert.equal(second.decision.ready, true);

  const store = new EligibilityEpisodeStore();
  store.observe(observation({ assetNetEdge: 0.09 }));
  const ready = store.observe(observation({
    nowMs: 1_200,
    bookGeneration: "100:2",
    chainlinkGeneration: "BTC:1200",
    assetNetEdge: 0.09,
    bookConfirmed: true,
  }));
  assert.equal(ready.ready, true);
  const final = store.revalidateFinalEdge(ready.key, {
    assetNetEdge: 0.09,
    independentAssetPolicyEligible: true,
    calibratedPolicyEligible: false,
    calibratedPolicyReason: "calibrated_net_edge_below_floor",
    bookConfirmed: true,
  });
  assert.equal(final.ready, false);
  assert.equal(final.reason, "calibrated_net_edge_below_floor");
});

test("final weighted fill must satisfy stronger correlated asset edge", () => {
  const store = new EligibilityEpisodeStore();
  let decision;
  for (const [index, offset] of [0, 175, 350].entries()) {
    decision = store.observe(observation({
      nowMs: 1_000 + offset,
      bookGeneration: `100:${index + 1}`,
      chainlinkGeneration: index === 0 ? "BTC:1000" : "BTC:1175",
      assetNetEdge: 0.08,
      correlationIndex: 1,
    }));
  }
  assert.equal(decision.ready, true);
  const final = store.revalidateFinalEdge(decision.key, {
    assetNetEdge: 0.055,
    independentAssetPolicyEligible: true,
    calibratedPolicyEligible: true,
    bookConfirmed: true,
    correlationIndex: 1,
  });
  assert.equal(final.ready, false);
  assert.equal(final.reason, "eligibility_episode_final_fill_current_asset_edge_not_strong_enough");
});

test("second same-direction correlated asset needs one more book and 200ms more", () => {
  let state = null;
  let result;
  for (const [index, offset] of [0, 175, 350].entries()) {
    result = advanceEligibilityEpisode(state, observation({
      nowMs: 1_000 + offset,
      bookGeneration: `100:${index + 1}`,
      chainlinkGeneration: index === 0 ? "BTC:1000" : "BTC:1175",
      assetNetEdge: 0.08,
      correlationIndex: 1,
    }));
    state = result.state;
  }
  assert.equal(result.decision.requirements.requiredSnapshots, 3);
  assert.equal(result.decision.requirements.requiredDurationMs, 350);
  assert.equal(result.decision.ready, true);
});

test("episode store is bounded and session generation is part of the key", () => {
  const store = new EligibilityEpisodeStore({ maxEntries: 3, ttlMs: 60_000 });
  for (let index = 0; index < 10; index += 1) {
    const key = buildEligibilityEpisodeKey({ sessionGeneration: 2, slug: `slug-${index}`, side: "UP" });
    store.observe(observation({
      key,
      slug: `slug-${index}`,
      nowMs: 1_000 + index,
      bookGeneration: `${index}:1`,
      chainlinkGeneration: `BTC:${1_000 + index}`,
    }));
  }
  assert.ok(store.size <= 3);
  assert.equal(buildEligibilityEpisodeKey({ sessionGeneration: 2, slug: "x", side: "UP" }), "2|x|UP");
});

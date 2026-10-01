import assert from "node:assert/strict";
import { test } from "node:test";
import { sameKnownSpeaker, speakerTurnSeconds } from "./speaker";

test("unknown voices never qualify as the same person for paragraph grouping", () => {
  for (const [left, right] of [[null, null], ["", ""], [" ", null], [null, 1], [1, null]] as const) {
    assert.equal(sameKnownSpeaker(left, right), false);
  }
  assert.equal(sameKnownSpeaker(1, "1"), true);
  assert.equal(sameKnownSpeaker(1, 2), false);
});

test("explicit timestamps keep early milliseconds from becoming thousands of seconds", () => {
  assert.equal(speakerTurnSeconds({ time: 8000, time_ms: 8000 }), 8);
  assert.equal(speakerTurnSeconds({ time: 30000, time_ms: 30000 }), 30);
  assert.equal(speakerTurnSeconds({ time_ms: 0 }), 0);
  assert.equal(speakerTurnSeconds({ time: "3" }), 3);
  assert.equal(speakerTurnSeconds({}), null);
});

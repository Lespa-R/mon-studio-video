import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHistory } from "../lib/history.mjs";

const clip = () => ({ id: "vid_1", effects: [], matteOptions: { model: "person" } });

test("undo puts the clip back step by step, redo replays them", () => {
  let t = 0;
  const h = makeHistory({ now: () => (t += 10000) });
  const v = clip();
  h.remember(v, "effects::POST", "ajout d'effet");
  v.effects = [{ id: "fx_1", params: { text: "a" } }];
  h.remember(v, "effects:fx_1:PATCH", "réglage d'effet");
  v.effects = [{ id: "fx_1", params: { text: "b" } }];

  assert.equal(h.travel(v, "undo"), "réglage d'effet");
  assert.equal(v.effects[0].params.text, "a");
  assert.equal(h.travel(v, "undo"), "ajout d'effet");
  assert.deepEqual(v.effects, []);
  assert.equal(h.travel(v, "undo"), null);
  assert.equal(h.travel(v, "redo"), "ajout d'effet");
  assert.equal(h.travel(v, "redo"), "réglage d'effet");
  assert.equal(v.effects[0].params.text, "b");
});

test("a burst on the same thing is one step; a new edit clears redo", () => {
  let t = 0;
  const h = makeHistory({ now: () => (t += 100) });
  const v = clip();
  v.effects = [{ id: "fx_1", params: { size: 1 } }];
  for (let i = 2; i <= 5; i++) { h.remember(v, "effects:fx_1:PATCH", "réglage"); v.effects = [{ id: "fx_1", params: { size: i } }]; }
  h.travel(v, "undo");
  assert.equal(v.effects[0].params.size, 1);
  h.remember(v, "effects::POST", "ajout");
  assert.equal(h.peek("vid_1").redo, null);
});

test("steps that would change nothing are skipped, subtitles come and go", () => {
  let t = 0;
  const h = makeHistory({ now: () => (t += 10000) });
  const v = clip();
  h.remember(v, "captions::POST", "sous-titres");
  v.captions = { lang: "fr-FR", cues: [] };
  h.remember(v, "matte::PATCH", "découpe"); // refused by the server: nothing changed
  assert.equal(h.travel(v, "undo"), "sous-titres");
  assert.equal(v.captions, undefined);
});

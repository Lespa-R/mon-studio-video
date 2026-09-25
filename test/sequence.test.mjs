import { test } from "node:test";
import assert from "node:assert/strict";
import { composeSequence, sequenceDuration, clipsNeedingMatte } from "../lib/compose.mjs";
import { defaultParams } from "../lib/effects.mjs";

const clip = (id, effects = [], duration = 3) => ({
  id, width: 1280, height: 720, duration, hasAudio: true,
  face: { centreX: 680, chinMin: 508, chinMax: 533, faceHeight: 219 },
  effects,
});
const fx = (type, extra = {}) => ({
  id: `fx_${type.replace(/-/g, "")}`, type, enabled: true, start: 0, duration: null,
  params: defaultParams(type), ...extra,
});
const files = (v) => ({ bgFile: `${v.id}-bg.mov`, fgFile: `${v.id}-fg.webm` });
const attr = (html, id, name) => Number(new RegExp(`id="${id}"[^>]*?${name}="([\\d.]+)"`, "s").exec(html)[1]);

test("shots are laid end to end, trimmed", () => {
  const a = clip("vid_a"), b = clip("vid_b");
  const html = composeSequence({
    format: {}, files,
    shots: [
      { id: "sh_1", video: a, in: 0.5, out: 2, transition: "cut" },
      { id: "sh_2", video: b, in: 1, out: null, transition: "cut" },
    ],
  });
  assert.equal(attr(html, "bg_sh_1", "data-start"), 0);
  assert.equal(attr(html, "bg_sh_1", "data-media-start"), 0.5);
  assert.equal(attr(html, "bg_sh_2", "data-start"), 1.5, "shot 2 starts when shot 1 ends");
  assert.equal(attr(html, "bg_sh_2", "data-media-start"), 1);
  assert.equal(attr(html, "bg_sh_2", "data-duration"), 2, "out: null runs to the clip's end");
  assert.match(html, /id="root"[\s\S]*?data-duration="3.5"/);
});

test("the sequence duration matches the composition", () => {
  const a = clip("vid_a");
  const shots = [{ id: "s1", video: a, in: 0, out: 1.2 }, { id: "s2", video: a, in: 2, out: null }];
  assert.equal(sequenceDuration(shots), 2.2);
});

test("the same clip used twice produces no duplicate ids", () => {
  const a = clip("vid_a", [fx("behind-text"), fx("lower-third")]);
  const html = composeSequence({
    format: {}, files,
    shots: [{ id: "sh_1", video: a, in: 0, out: 1 }, { id: "sh_2", video: a, in: 1, out: 2 }],
  });
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "every id is unique");
});

test("an effect entirely outside a shot's cut is left out of that shot", () => {
  const a = clip("vid_a", [fx("title", { start: 2.2, duration: 0.5 })]);
  const html = composeSequence({
    format: {}, files, shots: [{ id: "sh_1", video: a, in: 0, out: 1.5 }],
  });
  assert.doesNotMatch(html, /sh_1_fx_title/);
});

test("an effect is re-timed from clip time to shot time", () => {
  // Title at 1.4s in the clip, shot starts at 1s of that clip and at 2s in
  // the sequence → the title comes in 0.4s into the shot, 2.4s overall.
  const a = clip("vid_a");
  const b = clip("vid_b", [fx("title", { start: 1.4, duration: 1 })]);
  const html = composeSequence({
    format: {}, files,
    shots: [{ id: "sh_1", video: a, in: 0, out: 2 }, { id: "sh_2", video: b, in: 1, out: 3 }],
  });
  const block = html.slice(html.indexOf("sh_2_fx_title-ch\","));
  assert.match(block, /\},\s*0\.4\);/, "entrance at 0.4s in the shot");
  assert.match(html, /root\.add\(tl, 2\);/, "the shot is nested at 2s");
});

test("the output format sets the canvas", () => {
  const html = composeSequence({
    format: { aspect: "9:16", size: 1080 }, files, shots: [{ id: "s", video: clip("v") }],
  });
  assert.match(html, /data-width="1080"/);
  assert.match(html, /data-height="1920"/);
});

test("screen-anchored effects sit on the canvas, not inside the recropped stage", () => {
  const a = clip("vid_a", [fx("vignette"), fx("behind-text")]);
  const html = composeSequence({
    format: { aspect: "9:16", size: 720 }, files, shots: [{ id: "s", video: a }],
  });
  const stage = html.slice(html.indexOf('id="stage_s"'), html.indexOf("</div>\n", html.indexOf('id="stage_s"')));
  assert.ok(stage.includes("s_fx_behindtext"), "the text behind you is on the stage");
  assert.ok(!stage.includes("s_fx_vignette"), "the vignette frames the output");
});

test("adapting a clip into a taller frame fills the bands", () => {
  const blur = composeSequence({
    format: { aspect: "9:16", fit: "contain", fill: "blur" }, files, shots: [{ id: "s", video: clip("v") }],
  });
  assert.match(blur, /id="fill_s"/);
  const black = composeSequence({
    format: { aspect: "9:16", fit: "contain", fill: "#000000" }, files, shots: [{ id: "s", video: clip("v") }],
  });
  assert.doesNotMatch(black, /id="fill_s"/);
  assert.match(black, /background: #000000/);
});

test("a dip to black is drawn only where asked", () => {
  const a = clip("vid_a");
  const html = composeSequence({
    format: {}, files,
    shots: [
      { id: "s1", video: a, out: 1 },
      { id: "s2", video: a, out: 1, transition: "black" },
      { id: "s3", video: a, out: 1, transition: "cut" },
    ],
  });
  assert.match(html, /id="tr_s2"/);
  assert.doesNotMatch(html, /id="tr_s3"/);
});

test("only the first shot is visible at the start", () => {
  const a = clip("vid_a");
  const html = composeSequence({
    format: {}, files, shots: [{ id: "s1", video: a, out: 1 }, { id: "s2", video: a, out: 1 }],
  });
  assert.doesNotMatch(html, /#stage_s1, \[id\^="s1_"\] \{ visibility: hidden/);
  assert.match(html, /#stage_s2, \[id\^="s2_"\] \{ visibility: hidden/);
});

test("each clip that needs a cut-out is listed once", () => {
  const a = clip("vid_a", [fx("behind-text")]);
  const b = clip("vid_b", [fx("title")]);
  const needs = clipsNeedingMatte([{ video: a }, { video: b }, { video: a }]);
  assert.deepEqual(needs.map((v) => v.id), ["vid_a"]);
});

test("an empty sequence is refused rather than rendered blank", () => {
  assert.throws(() => composeSequence({ format: {}, files, shots: [] }), /au moins un plan/);
});

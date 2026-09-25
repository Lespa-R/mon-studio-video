import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, needsMatte } from "../lib/compose.mjs";
import { EFFECTS, byType, catalogue, defaultParams } from "../lib/effects.mjs";

const video = (effects = []) => ({
  id: "vid_t", width: 1280, height: 720, duration: 3, hasAudio: true,
  face: { centreX: 680, chinMin: 508, chinMax: 533, faceHeight: 219 },
  effects,
});

const fx = (type, extra = {}) => ({
  id: `fx_${type.replace(/-/g, "")}`, type, enabled: true, start: 0, duration: null,
  params: defaultParams(type), ...extra,
});

const files = { bgFile: "bg.mov", fgFile: "fg.webm" };

test("a clip with no effects is the footage and its audio, no cut-out", () => {
  const html = compose(video(), files);
  assert.match(html, /id="bg"/);
  assert.match(html, /id="bg-audio"/);
  assert.doesNotMatch(html, /id="fg"/);
});

test("the cut-out layer appears only when an effect sits behind the person", () => {
  assert.equal(needsMatte(video([fx("title")])), false);
  assert.equal(needsMatte(video([fx("behind-text")])), true);
  assert.match(compose(video([fx("behind-text")]), files), /id="fg"/);
});

test("a disabled effect is left out entirely", () => {
  const html = compose(video([fx("title", { enabled: false })]), files);
  assert.doesNotMatch(html, /fx_title/);
});

test("background blur hits the background only, so the person stays sharp", () => {
  const html = compose(video([fx("behind-text"), fx("bg-blur")]), files);
  assert.match(html, /#bg \{[^}]*blur\(14px\)/);
  assert.doesNotMatch(html, /#fg \{[^}]*blur/);
});

test("a grade reaches both layers, or the cut-out would stop matching", () => {
  const html = compose(video([fx("behind-text"), fx("grade")]), files);
  assert.match(html, /#bg \{[^}]*contrast\(/);
  assert.match(html, /#fg \{[^}]*contrast\(/);
});

test("stacked treatments compose instead of overwriting each other", () => {
  const html = compose(video([fx("behind-text"), fx("bg-blur"), fx("grade")]), files);
  const bgRule = html.match(/#bg \{[^}]*filter: ([^;]*);/)[1];
  assert.match(bgRule, /blur\(/);
  assert.match(bgRule, /contrast\(/);
});

test("text is clamped inside the frame whatever the rise slider says", () => {
  for (const rise of [-5, 5]) {
    const built = byType("behind-text").build(
      fx("behind-text", { params: { ...defaultParams("behind-text"), rise } }), video());
    const top = Number(built.css.match(/top: (-?\d+)px/g).pop().match(/-?\d+/)[0]);
    assert.ok(top >= 0 && top <= 720, `rise ${rise} placed the text at ${top}px`);
  }
});

test("text high in the frame leaves downwards, so it never slides off the top", () => {
  const high = byType("behind-text").build(
    fx("behind-text", { params: { ...defaultParams("behind-text"), rise: 2 } }), video());
  assert.match(high.timeline, /yPercent: 40/);
  const low = byType("behind-text").build(fx("behind-text"), video());
  assert.match(low.timeline, /yPercent: -40/);
});

test("every catalogue effect builds for a typical clip", () => {
  for (const effect of EFFECTS) {
    assert.doesNotThrow(() => effect.build(fx(effect.type), video()), effect.type);
  }
});

test("the catalogue sent to the UI is plain JSON", () => {
  const list = catalogue();
  assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
});

test("a title containing </script> cannot break out of the composition's script",
  { todo: "lot 3 : échapper le texte injecté dans le <script>" }, () => {
    // Every <script> the composition opens must be closed by a tag it wrote
    // itself; the text must not contribute a closing tag of its own.
    const text = "Fin</script><b>";
    const html = compose(video([fx("title", { params: { ...defaultParams("title"), text } })]), files);
    const opened = html.match(/<script\b/gi).length;
    const closed = html.match(/<\/script>/gi).length;
    assert.equal(closed, opened);
  });

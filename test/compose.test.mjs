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
  assert.match(html, /id="bg_s0"/);
  assert.match(html, /id="audio_s0"/);
  assert.doesNotMatch(html, /id="fg_s0"/);
});

test("the cut-out layer appears only when an effect sits behind the person", () => {
  assert.equal(needsMatte(video([fx("title")])), false);
  assert.equal(needsMatte(video([fx("behind-text")])), true);
  assert.match(compose(video([fx("behind-text")]), files), /id="fg_s0"/);
});

test("a disabled effect is left out entirely", () => {
  const html = compose(video([fx("title", { enabled: false })]), files);
  assert.doesNotMatch(html, /s0_fx_title/);
});

test("background blur hits the background only, so the person stays sharp", () => {
  const html = compose(video([fx("behind-text"), fx("bg-blur")]), files);
  assert.match(html, /#bg_s0 \{[^}]*blur\(14px\)/);
  assert.doesNotMatch(html, /#fg_s0 \{[^}]*blur/);
});

test("a grade reaches both layers, or the cut-out would stop matching", () => {
  const html = compose(video([fx("behind-text"), fx("grade")]), files);
  assert.match(html, /#bg_s0 \{[^}]*contrast\(/);
  assert.match(html, /#fg_s0 \{[^}]*contrast\(/);
});

test("stacked treatments compose instead of overwriting each other", () => {
  const html = compose(video([fx("behind-text"), fx("bg-blur"), fx("grade")]), files);
  const bgRule = html.match(/#bg_s0 \{[^}]*filter: ([^;]*);/)[1];
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

test("a text's exit is over by the end of its window, last letter included", () => {
  // 10 letters, stagger 0.04 → the cascade adds 0.36s to the 0.5s exit.
  const params = { ...defaultParams("title"), text: "Hello World", exit: 0.5, stagger: 0.04 };
  const built = byType("title").build(fx("title", { start: 0, duration: 2, params }), video());
  const exitAt = Number(/tl\.to\("#fx_title \.fx_title-ch",[\s\S]*?\},\s*([\d.]+)\);/.exec(built.timeline)[1]);
  const lastLetterDone = exitAt + 0.5 + 0.04 * 9;
  assert.ok(lastLetterDone <= 2 + 1e-9, `last letter leaves at ${lastLetterDone}s, window ends at 2s`);
});

test("a window too short for both animations compresses them instead of overrunning", () => {
  // Entrance 0.75 + 0.36, exit 0.5 + 0.36: ~2s of animation in a 1.4s window.
  const params = { ...defaultParams("title"), text: "Hello World", reveal: 0.75, exit: 0.5, stagger: 0.04 };
  const built = byType("title").build(fx("title", { start: 0, duration: 1.4, params }), video());
  const exitCall = /tl\.to\("#fx_title \.fx_title-ch",[\s\S]*?duration: ([\d.]+)[\s\S]*?each: ([\d.]+)[\s\S]*?\},\s*([\d.]+)\);/.exec(built.timeline);
  const [exit, each, at] = exitCall.slice(1).map(Number);
  assert.ok(at + exit + each * 9 <= 1.4 + 0.002, "exit over by the end of the window");
  const entrance = /duration: ([\d.]+), ease: "power3\.out", stagger: ([\d.]+)/.exec(built.timeline);
  assert.ok(Number(entrance[1]) + Number(entrance[2]) * 9 <= at + 0.002, "entrance done before the exit starts");
});

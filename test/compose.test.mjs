import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, needsMatte } from "../lib/compose.mjs";
import * as EFFECTS_MODULE from "../lib/effects.mjs";
import { EFFECTS, byType, catalogue, defaultParams } from "../lib/effects.mjs";

// The output frame as canvas effects see it.
const canvas = { width: 1080, height: 1920, duration: 3, hasAudio: false, face: null };

// The time at which the last tween of a timeline ends (position + duration,
// plus its stagger or repeats). Good enough for the shapes generated here.
function lastEnd(timeline, units = 1) {
  let end = 0;
  const re = /tl\.(fromTo|to|set)\(([\s\S]*?)\);/g;
  let m;
  while ((m = re.exec(timeline))) {
    const body = m[2];
    const at = Number(body.match(/,\s*([\d.]+)\s*$/)?.[1] ?? 0);
    const durs = [...body.matchAll(/duration: ([\d.]+)/g)].map((x) => Number(x[1]));
    const d = durs.length ? durs[durs.length - 1] : 0;
    const stagger = Number(body.match(/(?:stagger|each): ([\d.]+)/)?.[1] ?? 0);
    const repeat = Number(body.match(/repeat: (\d+)/)?.[1] ?? 0);
    const delay = Number(body.match(/repeatDelay: ([\d.]+)/)?.[1] ?? 0);
    end = Math.max(end, at + d * (repeat + 1) + delay * repeat + (stagger ? stagger * (units - 1) : 0));
  }
  return end;
}

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
  assert.match(html, /id="audio"/);
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

test("a title containing </script> cannot break out of the composition's script", () => {
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

// ------------------------------------------------------------ output format

test("the output format sets the canvas", () => {
  const html = compose(video(), files, { aspect: "9:16", size: 1080 });
  assert.match(html, /data-width="1080"/);
  assert.match(html, /data-height="1920"/);
});

test("screen-anchored effects sit on the canvas, not inside the recropped stage", () => {
  const html = compose(video([fx("vignette"), fx("behind-text")]), files, { aspect: "9:16" });
  const stage = html.slice(html.indexOf('<div id="stage">'), html.indexOf("</div>\n", html.indexOf('<div id="stage">')));
  assert.ok(stage.includes("fx_behindtext"), "the text behind you is on the stage");
  assert.ok(!stage.includes("fx_vignette"), "the vignette frames the output");
});

test("adapting a clip into a taller frame fills the bands", () => {
  assert.match(compose(video(), files, { aspect: "9:16", fit: "contain", fill: "blur" }), /id="fill"/);
  const black = compose(video(), files, { aspect: "9:16", fit: "contain", fill: "#000000" });
  assert.doesNotMatch(black, /id="fill"/);
  assert.match(black, /background: #000000/);
});

test("a recrop narrows the width text may use", () => {
  const wide = byType("title").build(fx("title"), video());
  const narrow = byType("title").build(fx("title"),
    { ...video(), view: { x: 437, y: 0, w: 405, h: 720 } });
  const max = (b) => Number(/if \(width > (\d+)\)/.exec(b.init)[1]);
  assert.ok(max(narrow) < max(wide));
  assert.ok(max(narrow) <= 405);
});

// ------------------------------------------------------ background replacement

const replace = (params = {}) =>
  fx("bg-replace", { params: { ...defaultParams("bg-replace"), ...params } });

test("replacing the background needs the cut-out, and sits under it", () => {
  const html = compose(video([replace()]), files);
  assert.match(html, /id="fg"/, "the person is laid back over the new background");
  const bgAt = html.indexOf('id="fx_bgreplace"');
  assert.ok(bgAt > html.indexOf('id="bg"') && bgAt < html.indexOf('id="fg"'),
    "between the original footage and the person");
});

test("text placed behind the person stays in front of the new background", () => {
  const html = compose(video([replace(), fx("behind-text")]), files);
  const z = (sel) => Number(new RegExp(`${sel} \\{[^}]*?z-index: (\\d+)`).exec(html)[1]);
  assert.ok(z("#fx_bgreplace") < z("#fx_behindtext"));
});

test("an uploaded image is used as the background", () => {
  const built = byType("bg-replace").build(replace({ mode: "image", image: "asset_0123456789abcdef.jpg" }), video());
  assert.match(built.html, /<img class="fx_bgreplace-bg" src="media\/asset_0123456789abcdef\.jpg"/);
});

test("an image param that is not a studio asset name is ignored, never injected", () => {
  for (const image of ['x.jpg" onerror="alert(1)', "../../etc/passwd.png", "asset_zz.png", "asset_0123456789abcdef.svg"]) {
    const built = byType("bg-replace").build(replace({ mode: "image", image }), video());
    assert.doesNotMatch(built.html, /<img/, image);
  }
});

test("a gradient and a flat colour need no image", () => {
  const g = byType("bg-replace").build(replace({ mode: "gradient", angle: 90 }), video());
  // By default the gradient follows the brand kit.
  assert.match(g.css, /linear-gradient\(90deg, var\(--brand-surface\), var\(--brand-primary\)\)/);
  const c = byType("bg-replace").build(replace({ mode: "color", color: "#ff0000" }), video());
  assert.match(c.css, /background: #ff0000/);
});

test("the grade reaches the new background, so it matches the person", () => {
  const html = compose(video([replace(), fx("grade")]), files);
  assert.match(html, /\.footage-layer \{ filter: [^}]*contrast\(/);
  assert.match(html, /id="fx_bgreplace" class="clip footage-layer"/);
});

// ------------------------------------------------------------ brand kit

test("the brand kit becomes variables on #root, and linked colours use them", () => {
  const brand = { id: "brd_1", name: "X", colors: { primary: "#ff0055", secondary: "#00ff00", text: "#111111", surface: "#fafafa" },
    fonts: { title: "Georgia", body: "Avenir Next" }, logo: "" };
  const html = compose(video([fx("title")]), files, {}, brand);
  assert.match(html, /--brand-primary: #ff0055;/);
  assert.match(html, /--font-title: "Georgia", serif;/);
  assert.match(html, /--font-body: "Avenir Next", sans-serif;/);
  assert.match(html, /color: var\(--brand-text\);/);
  assert.match(html, /font-family: var\(--font-title\);/);
});

test("a colour picked by hand stays that colour whatever the brand", () => {
  const html = compose(video([fx("title", { params: { ...defaultParams("title"), color: "#123456" } })]), files);
  assert.match(html, /color: #123456;/);
});

test("an imported font gets an @font-face and delays the text measurements", () => {
  const brand = { colors: {}, fonts: { title: "file:font_0123456789abcdef.woff2", body: "system" } };
  const html = compose(video([fx("title")]), files, {}, brand);
  assert.match(html, /@font-face \{ font-family: "brand-title"; src: url\("media\/font_0123456789abcdef\.woff2"\) format\("woff2"\)/);
  assert.match(html, /document\.fonts\.load\('800 64px "brand-title"'\)/);
});

test("a font or colour that is not in the allowed shapes never reaches the page", () => {
  const brand = { colors: { primary: "red;}</style><script>" }, fonts: { title: "file:../../x.woff2", body: "Comic\" Sans" } };
  const html = compose(video([fx("lower-third")]), files, {}, brand);
  assert.doesNotMatch(html, /<script>alert|\.\.\/|Comic/);
  assert.match(html, /--brand-primary: #4f8cff;/);
});

// ----------------------------------------------------------- animations

test("every text animation style builds, and ends inside its window", () => {
  const { TEXT_ANIMS } = EFFECTS_MODULE;
  for (const anim of Object.keys(TEXT_ANIMS)) {
    const built = byType("title").build(
      fx("title", { start: 0.5, duration: 1.2, params: { ...defaultParams("title"), anim } }), video());
    assert.ok(built.timeline.includes("tl.fromTo"), anim);
    const units = anim === "words" ? 2 : anim === "wipe" ? 1 : 8; // "Mon titre"
    assert.ok(lastEnd(built.timeline, units) <= 1.7 + 1e-6, `${anim} ends at ${lastEnd(built.timeline, units)}`);
  }
});

test("every animation effect finishes inside a short window", () => {
  for (const effect of EFFECTS.filter((e) => e.category === "Animations")) {
    const built = effect.build(fx(effect.type, { start: 1, duration: 1.2 }), canvas);
    if (!built) continue; // the logo needs an image
    const units = effect.type === "bullets" ? 3 : 1;
    assert.ok(lastEnd(built.timeline, units) <= 2.2 + 1e-6, `${effect.type} ends at ${lastEnd(built.timeline, units)}`);
  }
});

test("the counter writes French numbers and lands on its value", () => {
  const built = byType("counter").build(
    fx("counter", { params: { ...defaultParams("counter"), from: 0, to: 12500.5, decimals: "1" } }), canvas);
  assert.match(built.timeline, /textContent: "12\u202f500,5"/);
});

test("the logo falls back to the brand's logo, and needs one", () => {
  assert.equal(byType("logo").build(fx("logo"), canvas), null);
  const built = byType("logo").build(fx("logo"), { ...canvas, brand: { logo: "asset_0123456789abcdef.png" } });
  assert.match(built.html, /src="media\/asset_0123456789abcdef\.png"/);
});

test("lists split on slashes and never inject markup", () => {
  const built = byType("bullets").build(
    fx("bullets", { params: { ...defaultParams("bullets"), items: "Un / <b>deux / trois" } }), canvas);
  assert.equal((built.html.match(/-li"/g) || []).length, 3);
  assert.doesNotMatch(built.html, /<b>/);
});

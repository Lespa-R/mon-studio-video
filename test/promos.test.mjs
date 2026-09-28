import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENE_TYPES, sceneType, getPath, setPath, toText, fromText, normaliseStoryboard,
  starterStoryboard, promoTiming, storyboardWarnings, promoBrand, slugify, SLUG, newScene,
} from "../lib/promos.mjs";

test("every scene type has a label, a default duration and valid fields", () => {
  for (const t of SCENE_TYPES) {
    assert.ok(t.label && t.bars >= 1 && t.energy, t.type);
    for (const f of t.fields) {
      assert.ok(["text", "rich", "number", "lines", "tuples", "rows"].includes(f.kind), `${t.type}.${f.key}`);
      if (f.kind === "rows") assert.ok(Array.isArray(f.cols));
      if (f.kind === "tuples") assert.equal(typeof f.cols, "number");
    }
  }
});

test("dotted keys reach nested props and empty values are removed", () => {
  const p = {};
  setPath(p, "app.name", "FitCoach");
  assert.equal(getPath(p, "app.name"), "FitCoach");
  setPath(p, "app.name", "");
  assert.deepEqual(p, { app: {} });
});

test("form text round-trips for every field kind", () => {
  const rows = sceneType("chat").fields.find((f) => f.key === "messages");
  const msgs = [{ who: "Laurent", role: "Fondateur", quote: "Exigeante et complète" }];
  assert.deepEqual(fromText(rows, toText(rows, msgs)), msgs);
  // The last column keeps a « | » typed inside a quote.
  assert.equal(fromText(rows, "A | B | un | deux")[0].quote, "un | deux");

  const tuples = sceneType("counters").fields.find((f) => f.key === "items");
  assert.deepEqual(fromText(tuples, "15+ | startups\n50+"), [["15+", "startups"], ["50+", ""]]);

  const lines = sceneType("stamps").fields[0];
  assert.deepEqual(fromText(lines, " Une idée. \n\n*Zéro* code "), ["Une idée.", "*Zéro* code"]);
  assert.equal(toText(lines, ["a", "b"]), "a\nb");
});

test("normalise drops unknown scenes and clamps values", () => {
  const sb = normaliseStoryboard({
    formats: ["4:5", "4:5", "3:2"], music: { mood: "jazz", bpm: 400 },
    scenes: [{ type: "nope" }, { type: "stamps", bars: 99, energy: "weird", props: [] }],
  });
  assert.deepEqual(sb.formats, ["4:5"]);
  assert.deepEqual(sb.music, { mode: "generate", mood: "electro", bpm: 180 });
  assert.equal(sb.scenes.length, 1);
  assert.deepEqual(sb.scenes[0], { type: "stamps", bars: 8, energy: "intro", props: {} });
});

test("a file soundtrack keeps its file and offset", () => {
  const sb = normaliseStoryboard({ music: { mode: "file", file: "music/a.mp3", offset: "0.37", bpm: 124 } });
  assert.deepEqual(sb.music, { mode: "file", mood: "electro", bpm: 124, file: "music/a.mp3", offset: 0.37 });
});

test("timing follows the tempo", () => {
  const t = promoTiming({ music: { bpm: 120 }, scenes: [{ bars: 2 }, { bars: 3 }] });
  assert.equal(t.bar, 2);
  assert.deepEqual(t.scenes, [{ start: 0, duration: 4 }, { start: 4, duration: 6 }]);
  assert.equal(t.total, 11.5);
});

test("the starter storyboard is renderable and warns about missing figures", () => {
  const sb = starterStoryboard("Vintage Club", "https://vintageclubseries.com/");
  assert.equal(sb.scenes[0].type, "stamps");
  assert.equal(sb.scenes.at(-1).props.url, "vintageclubseries.com");
  assert.ok(storyboardWarnings(sb).some((w) => w.includes("aucun chiffre")));
});

test("warnings catch structure and text problems", () => {
  const w = storyboardWarnings({
    music: { bpm: 120 },
    scenes: [
      { ...newScene("stamps"), props: { words: ["Pilotage à l'ancienne."] } },
      newScene("steps"),
      newScene("headline"),
    ],
  });
  assert.ok(w.some((x) => x.includes("16 caractères")));
  assert.ok(w.some((x) => x.includes("pause doit déboucher")));
  assert.ok(w.some((x) => x.includes("Final")));
});

test("promo brand maps studio fonts and lists files to copy", () => {
  const { json, copies } = promoBrand(
    { id: "brd_1", name: "VCS", colors: { primary: "#3b4b2f" }, fonts: { title: "file:font_ab.woff2", body: "Avenir Next" }, logo: "asset_cd.png" },
    { fonts: [{ file: "font_ab.woff2", name: "Bebas Neue" }], labels: { "Avenir Next": "Avenir Next" }, logo: { tile: true, aspect: 5.7 } },
  );
  assert.deepEqual(json.fonts, { title: { family: "Bebas Neue", file: "brand/title.woff2" }, body: { family: "Avenir Next" } });
  assert.deepEqual(copies, [{ from: "font_ab.woff2", to: "title.woff2" }]);
  assert.equal(json.logoTile, true);
  assert.equal(json.logoAspect, 5.7);
});

test("slugs are safe folder names", () => {
  assert.equal(slugify("Vintage Club Séries !"), "vintage-club-series");
  assert.ok(SLUG.test(slugify("x")));
  assert.ok(!SLUG.test("../etc"));
});

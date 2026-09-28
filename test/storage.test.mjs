import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../lib/storage.mjs";

const f = (name, size = 100, mtime = 0) => ({ name, size, mtime });
const state = {
  projects: [{ id: "prj_1", name: "P", videos: [
    { id: "vid_a", name: "a.mov", ext: ".mov", effects: [{ params: { image: "asset_0123456789abcdef.png" } }] },
    { id: "vid_b", name: "b.mov", ext: ".mp4", trim: { start: 1, end: 2, source: 3, ext: ".mov" }, effects: [] },
  ] }],
  presets: [],
  brands: [{ fonts: { title: "file:font_0123456789abcdef.woff2" }, logo: "" }],
  fonts: [{ file: "font_fedcba9876543210.ttf" }],
};

test("each file lands in the right kind, with its clip", () => {
  const { items, totals } = classify({
    media: [
      f("vid_a-bg.mov", 1000), f("vid_a-fg.webm", 300), f("vid_a-people.json", 5),
      f("vid_b-bg.mp4", 400), f("vid_b-orig.mov", 900),
      f("vid_gone-bg.mov", 50), f("hello-world-bg.mov", 70), f("vid_a-fg.partial.webm", 7),
      f("asset_0123456789abcdef.png", 20), f("asset_ffffffffffffffff.jpg", 30),
      f("font_0123456789abcdef.woff2", 10), f("font_fedcba9876543210.ttf", 11),
    ],
    renders: [f("a-1.mp4", 500)],
    root: [f("studio.json", 9), f("render-job_x.html", 3), f("studio.corrupt-2026.json", 4)],
    cache: [f("captions-vid_a-1", 2)],
  }, state);
  const kind = (name) => items.find((x) => x.name === name).kind;
  assert.equal(kind("vid_a-bg.mov"), "source");
  assert.equal(items.find((x) => x.name === "vid_a-bg.mov").clip, "a.mov");
  assert.equal(kind("vid_a-fg.webm"), "matte");
  assert.equal(kind("vid_a-people.json"), "people");
  assert.equal(kind("vid_b-orig.mov"), "original");
  assert.equal(kind("vid_gone-bg.mov"), "orphan");
  assert.equal(kind("hello-world-bg.mov"), "orphan");
  assert.equal(kind("vid_a-fg.partial.webm"), "temp");
  assert.equal(kind("a-1.mp4"), "render");
  assert.equal(kind("render-job_x.html"), "temp");
  assert.equal(kind("studio.json"), "state");
  assert.equal(totals.source, 1400);
});

test("sources, the library and assets in use are never deletable", () => {
  const { items } = classify({
    media: [f("vid_a-bg.mov"), f("asset_0123456789abcdef.png"), f("asset_ffffffffffffffff.jpg"),
      f("font_0123456789abcdef.woff2"), f("font_fedcba9876543210.ttf")],
    root: [f("studio.json")],
  }, state);
  const del = (name) => items.find((x) => x.name === name).deletable;
  assert.equal(del("vid_a-bg.mov"), false);
  assert.equal(del("studio.json"), false);
  assert.equal(del("asset_0123456789abcdef.png"), false, "used by an effect");
  assert.equal(del("font_0123456789abcdef.woff2"), false, "used by a brand kit");
  assert.equal(del("asset_ffffffffffffffff.jpg"), true);
  assert.equal(del("font_fedcba9876543210.ttf"), true, "imported but used nowhere");
});

test("a file written in the last seconds is left alone", () => {
  const { items } = classify({ renders: [f("new.mp4", 10, Date.now())] }, state);
  assert.equal(items[0].deletable, false);
});

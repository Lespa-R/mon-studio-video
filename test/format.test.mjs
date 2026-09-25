import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasSize, stageTransform, normaliseFormat } from "../lib/format.mjs";

const src = { width: 1280, height: 720 };
const face = { centreX: 680, chinMin: 508, faceHeight: 219 };

test("source format keeps the clip's own size", () => {
  assert.deepEqual(canvasSize({}, src), { width: 1280, height: 720 });
});

test("the size is the short side of the canvas, whatever the ratio", () => {
  assert.deepEqual(canvasSize({ aspect: "9:16", size: 1080 }, src), { width: 1080, height: 1920 });
  assert.deepEqual(canvasSize({ aspect: "16:9", size: 1080 }, src), { width: 1920, height: 1080 });
  assert.deepEqual(canvasSize({ aspect: "1:1", size: 720 }, src), { width: 720, height: 720 });
  assert.deepEqual(canvasSize({ aspect: "4:5", size: 1080 }, src), { width: 1080, height: 1350 });
});

test("dimensions are always even, as H.264 requires", () => {
  const c = canvasSize({ aspect: "4:5", size: 721 }, src);
  assert.equal(c.width % 2, 0);
  assert.equal(c.height % 2, 0);
});

test("unknown values fall back to the defaults instead of breaking the render", () => {
  assert.deepEqual(normaliseFormat({ aspect: "3:7", size: 99, fit: "x", fill: "red;}" }),
    { aspect: "source", size: "source", fit: "cover", focus: "face", fill: "blur" });
});

test("cover fills the whole canvas", () => {
  const canvas = canvasSize({ aspect: "9:16", size: 720 }, src);
  const t = stageTransform(canvas, src, { fit: "cover" }, face);
  assert.ok(src.width * t.scale >= canvas.width - 0.01);
  assert.ok(src.height * t.scale >= canvas.height - 0.01);
  assert.ok(t.x <= 0 && t.x >= canvas.width - src.width * t.scale, "no gap on the sides");
});

test("cover aimed at the face keeps it centred on a vertical canvas", () => {
  const canvas = canvasSize({ aspect: "9:16", size: 720 }, src);
  const t = stageTransform(canvas, src, { fit: "cover", focus: "face" }, face);
  const onCanvas = t.x + face.centreX * t.scale;
  assert.ok(Math.abs(onCanvas - canvas.width / 2) < 1);
});

test("a face near the edge is not allowed to pull the frame off the footage", () => {
  const canvas = canvasSize({ aspect: "9:16", size: 720 }, src);
  const t = stageTransform(canvas, src, { fit: "cover" }, { ...face, centreX: 5 });
  assert.equal(t.x, 0);
});

test("the view is the part of the source actually on screen", () => {
  const canvas = canvasSize({ aspect: "9:16", size: 720 }, src);
  const t = stageTransform(canvas, src, { fit: "cover" }, face);
  assert.ok(Math.abs(t.view.w - 405) < 1);       // 720 px of canvas / 1.78
  assert.ok(Math.abs(t.view.h - 720) < 1);
  assert.ok(face.centreX > t.view.x && face.centreX < t.view.x + t.view.w);
});

test("contain shows the whole frame, centred, with bands", () => {
  const canvas = canvasSize({ aspect: "9:16", size: 720 }, src);
  const t = stageTransform(canvas, src, { fit: "contain" }, face);
  assert.deepEqual(t.view, { x: 0, y: 0, w: 1280, h: 720 });
  assert.equal(t.x, 0);
  assert.ok(t.y > 0);
});

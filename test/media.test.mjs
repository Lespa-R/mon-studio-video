import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProbe, summariseFaces, isHdr } from "../lib/media.mjs";

test("probe output is reduced to the fields the studio uses", () => {
  const info = parseProbe({
    streams: [{ width: 1280, height: 720, r_frame_rate: "30000/1001" }],
    format: { duration: "3.0643541" },
  }, true);
  assert.equal(info.width, 1280);
  assert.equal(info.fpsExact, "30000/1001");
  assert.ok(Math.abs(info.fps - 29.97) < 0.01);
  assert.equal(info.duration, 3.064);
  assert.equal(info.rotation, 0);
  assert.equal(info.hasAudio, true);
});

test("a rotation matrix is picked up from side data", () => {
  const info = parseProbe({
    streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
    format: {},
  }, false);
  assert.equal(info.rotation, -90);
});

test("a file with no video stream is rejected", () => {
  assert.throws(() => parseProbe({ streams: [], format: {} }, false), /no video/);
});

test("face placement uses the median centre and the highest chin", () => {
  const face = summariseFaces([
    { cx: 670, chin: 530, h: 210 },
    { cx: 680, chin: 508, h: 220 },
    { cx: 690, chin: 520, h: 230 },
    null,
  ]);
  assert.equal(face.centreX, 680);
  assert.equal(face.chinMin, 508);
  assert.equal(face.chinMax, 530);
  assert.equal(face.faceHeight, 220);
  assert.equal(face.coverage, 0.75);
});

test("no face at all gives null rather than a guess", () => {
  assert.equal(summariseFaces([null, {}]), null);
});

test("HDR, wide-gamut and 10-bit videos are spotted (they get an SDR working copy)", () => {
  assert.equal(isHdr({ color_transfer: "arib-std-b67", color_primaries: "bt2020", pix_fmt: "yuv420p" }), true); // phone HLG
  assert.equal(isHdr({ color_transfer: "smpte2084", pix_fmt: "yuv420p10le" }), true); // HDR10
  assert.equal(isHdr({ pix_fmt: "yuv420p10le" }), true);
  assert.equal(isHdr({ color_transfer: "bt709", color_primaries: "bt709", pix_fmt: "yuv420p" }), false);
  assert.equal(isHdr({}), false);
  const info = parseProbe({ streams: [{ width: 1440, height: 1920, r_frame_rate: "30/1", color_transfer: "arib-std-b67" }], format: { duration: "7.2" } }, true);
  assert.equal(info.hdr, true);
});

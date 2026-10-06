// Small helpers every effect module needs: reading params, writing numbers
// into CSS and GSAP calls, escaping what goes into markup and scripts, the
// sizes effects are drawn at, and short names for cached data.
//
// Pure functions only, no imports.

// A param as a number, or the fallback when it is not one ("", "abc", NaN…).
export const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Numbers written into the page: a tenth of a pixel, a millisecond.
export const r1 = (n) => Math.round(n * 10) / 10;
export const r3 = (n) => Number(Number(n).toFixed(3));

// Text inside HTML or CSS.
export const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A string literal safe to drop inside a <script>: JSON.stringify leaves "<"
// alone, so a text containing "</script>" would close the script early.
export const jsString = (v) => JSON.stringify(String(v)).replace(/</g, "\\u003c");

// The part of the source frame that ends up on screen. Without a recrop it is
// the whole frame; compose.mjs sets it when the output format crops.
export const viewOf = (video) => video.view || { x: 0, y: 0, w: video.width, h: video.height };

// The size unit effects are drawn with: 1 on a 720 px short side.
export const unitOf = (video) => Math.min(video.width, video.height) / 720;

// A short, stable name for some data (FNV-1a, 8 hex digits): the key of a
// cached track or layer, which changes when what made it changes.
export function shortHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

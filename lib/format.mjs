// Output format: the canvas the finished video is rendered into, and how each
// source clip is placed on it.
//
// Every clip is composed on a "stage" at its own native size, in its own pixel
// coordinates — that is what face detection measured, and what every effect is
// positioned against. The stage is then moved onto the canvas with a single
// transform. Recropping for 9:16 therefore never has to touch an effect: the
// footage, the text behind you and your cut-out move together, so the
// occlusion stays exact.
//
// Pure functions only.

export const ASPECTS = [
  { value: "source", label: "Source" },
  { value: "16:9", label: "16:9 · paysage" },
  { value: "9:16", label: "9:16 · vertical" },
  { value: "1:1", label: "1:1 · carré" },
  { value: "4:5", label: "4:5 · portrait" },
];

// The short side of the canvas.
export const SIZES = [
  { value: "source", label: "Source" },
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
];

export const FITS = [
  { value: "cover", label: "Remplir (recadrer)" },
  { value: "contain", label: "Adapter (bandes)" },
];

export const FOCUSES = [
  { value: "face", label: "Sur le visage" },
  { value: "center", label: "Au centre" },
];

export const FILLS = [
  { value: "blur", label: "Image floutée" },
  { value: "#000000", label: "Noir" },
  { value: "#ffffff", label: "Blanc" },
];

export const DEFAULT_FORMAT = Object.freeze({
  aspect: "source",
  size: "source",
  fit: "cover",
  focus: "face",
  fill: "blur",
});

export function normaliseFormat(format = {}) {
  const pick = (list, value, fallback) =>
    list.some((o) => String(o.value) === String(value))
      ? list.find((o) => String(o.value) === String(value)).value
      : fallback;
  return {
    aspect: pick(ASPECTS, format.aspect, DEFAULT_FORMAT.aspect),
    size: pick(SIZES, format.size, DEFAULT_FORMAT.size),
    fit: pick(FITS, format.fit, DEFAULT_FORMAT.fit),
    focus: pick(FOCUSES, format.focus, DEFAULT_FORMAT.focus),
    // A fill is either "blur" or a hex colour.
    fill: format.fill === "blur" || /^#[0-9a-f]{6}$/i.test(String(format.fill))
      ? format.fill
      : DEFAULT_FORMAT.fill,
  };
}

// H.264 needs even dimensions.
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// The canvas for a format. "source" dimensions come from the reference clip
// (the first shot of a sequence, or the clip itself).
export function canvasSize(format, source) {
  const f = normaliseFormat(format);
  const [aw, ah] = f.aspect === "source"
    ? [source.width, source.height]
    : f.aspect.split(":").map(Number);

  const short = f.size === "source" ? Math.min(source.width, source.height) : f.size;
  // Scale the ratio so its short side lands on `short`.
  const k = short / Math.min(aw, ah);
  return { width: even(aw * k), height: even(ah * k) };
}

// Where a source frame sits on the canvas: `scale`, `x`, `y` (the stage's
// top-left corner on the canvas), and `view` — the part of the source that is
// actually visible, in source pixels. Effects use `view` to keep text on screen.
export function stageTransform(canvas, source, format, face = null) {
  const f = normaliseFormat(format);
  const sw = source.width;
  const sh = source.height;

  if (f.fit === "contain") {
    const scale = Math.min(canvas.width / sw, canvas.height / sh);
    return {
      scale,
      x: (canvas.width - sw * scale) / 2,
      y: (canvas.height - sh * scale) / 2,
      view: { x: 0, y: 0, w: sw, h: sh },
    };
  }

  const scale = Math.max(canvas.width / sw, canvas.height / sh);

  // Aim at the face when there is one: horizontally its centre, vertically a
  // point slightly above its middle, to keep some headroom.
  const aim = f.focus === "face" && face
    ? { x: face.centreX, y: face.chinMin - face.faceHeight * 0.6 }
    : { x: sw / 2, y: sh / 2 };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const x = clamp(canvas.width / 2 - aim.x * scale, canvas.width - sw * scale, 0);
  const y = clamp(canvas.height / 2 - aim.y * scale, canvas.height - sh * scale, 0);

  return {
    scale,
    x,
    y,
    view: { x: -x / scale, y: -y / scale, w: canvas.width / scale, h: canvas.height / scale },
  };
}

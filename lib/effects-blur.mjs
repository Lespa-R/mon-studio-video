// « Flouter » — hide something that moves: a face, a licence plate, a
// passer-by, a logo (an object clicked in the effect, followed by SAM 2), or
// every person in the shot (the people's cut-out).
//
// The blurred (or pixelated, or blacked-out) layer is made once by ffmpeg —
// media.makeBlurLayer(), cached by the server as media/<id>-blur-<key>.webm —
// and laid over the footage here, above the cut-out (so a person passing in
// front is hidden too), under the texts.

import { timingOf, overlayTimeline } from "./timing.mjs";
import { num, clamp, shortHash } from "./util.mjs";
import { objectRequest, objectKey } from "./follow.mjs";

export const BLUR_MODES = [
  { value: "blur", label: "Flou" },
  { value: "pixels", label: "Pixels" },
  { value: "solid", label: "Masque noir" },
];

// What to make for a blur effect: { fxId, source, mode, strength, object?,
// key } — or null when there is nothing to hide yet (no object chosen).
export function blurRequest(fx, video) {
  if (fx.type !== "blur-object" || fx.enabled === false) return null;
  const p = fx.params || {};
  const mode = BLUR_MODES.some((m) => m.value === p.mode) ? p.mode : "blur";
  const strength = Math.round(clamp(num(p.strength, 1.6), 0.2, 4) * 100) / 100;
  const key = (parts) => shortHash(JSON.stringify(parts));
  if (p.source === "people") {
    return { fxId: fx.id, source: "people", mode, strength, key: key(["people", mode, strength, video.matteSignature || "", video.ext]) };
  }
  const req = objectRequest({ params: { ...p, source: "object" } });
  if (!req) return null;
  return { fxId: fx.id, source: "object", mode, strength, object: req, key: key(["object", objectKey(req, video), mode, strength]) };
}

const blurObject = {
  type: "blur-object",
  label: "Flouter (anonymiser)",
  hint: "Floute, pixellise ou masque ce qui doit rester caché — un visage, une plaque, un passant, un logo — en le suivant dans tout le clip. Clique dessus, ou choisis toutes les personnes.",
  needsMatte: false,
  timed: true,
  layer: "front",
  schema: [
    {
      key: "source", label: "Quoi", type: "select", default: "object",
      options: [
        { value: "object", label: "Un objet ou un visage (clique dessus)" },
        { value: "people", label: "Toutes les personnes (découpe)" },
      ],
    },
    { key: "object", label: "Objet à flouter", type: "object", default: null, showIf: { key: "source", values: ["object"] } },
    { key: "mode", label: "Style", type: "select", default: "blur", options: BLUR_MODES },
    { key: "strength", label: "Force", type: "range", min: 0.3, max: 3, step: 0.05, default: 1.6 },
  ],

  build(fx, video) {
    const p = fx.params;
    const id = fx.id;
    const t = timingOf(fx, video);
    const people = p.source === "people";
    const file = video.blurs?.[fx.id];
    // Not made yet (or nothing chosen): nothing to show — but the people's
    // cut-out must exist before the layer can be made from it.
    if (!file) {
      return { layer: "front", needsMatte: people, timing: t, css: "", html: "", init: "", timeline: "" };
    }
    return {
      layer: "front",
      needsMatte: people,
      timing: t,
      // A layer standing in for the footage (footage-layer): it takes the
      // clip's grade, like the picture around it. Played over the window only.
      css: `
      #${id} { z-index: 52; opacity: 0; pointer-events: none; }`,
      html: `
      <video id="${id}" class="clip footage-layer" data-start="${t.start}" data-duration="${t.duration}" data-media-start="${t.start}"
        src="media/${file}" muted></video>`,
      init: "",
      timeline: overlayTimeline(`#${id}`, t, 1, 0.25),
    };
  },
};

export const BLUR_EFFECTS = [blurObject];

// Turns a clip and its effect stack into a HyperFrames composition, on a
// canvas of the requested output format.
//
// Pure: same input, same HTML. That is what keeps renders reproducible, and it
// means the composition can be regenerated at any time from the saved state.
//
// Structure:
//
//   canvas (the output frame)
//   ├─ fill           blurred copy of the footage behind the bands, if any
//   ├─ stage          the source frame at its native size, moved onto the
//   │  │              canvas by one transform (see lib/format.mjs)
//   │  ├─  1 footage
//   │  ├─ 10 effects that sit behind the person
//   │  ├─ 50 the cut-out person      (only when something sits behind it)
//   │  └─ 55+ effects over the image
//   └─ 62+ screen-anchored effects   (lower third, vignette, grain, bands, fade)

import { byType, timingOf } from "./effects.mjs";
import { pinRequest, pinRange } from "./pins.mjs";
import { stageTimeline } from "./stage-motion.mjs";
import { canvasSize, stageTransform, normaliseFormat } from "./format.mjs";
import { brandCss, normaliseBrand, DEFAULT_BRAND } from "./brand.mjs";
import { r3 } from "./util.mjs";

// Where an effect is laid out: "stage" (source px, moves with the footage) or
// "canvas" (the output frame). Some decide per instance — an arrow pinned to
// the scenery goes on the stage.
const spaceOf = (effect, fx) => (typeof effect.space === "function" ? effect.space(fx) : effect.space || "stage");

export function buildEffects(video) {
  const built = [];
  for (const fx of video.effects || []) {
    if (fx.enabled === false) continue;
    const effect = byType(fx.type);
    if (!effect) continue;
    const fragment = effect.build(fx, video);
    if (fragment) built.push({ fx, space: spaceOf(effect, fx), ...fragment });
  }
  return built;
}

export function needsMatte(video) {
  return buildEffects(video).some((f) => f.needsMatte);
}

// The spots of the scenery the clip's pinned effects need followed
// (lib/pins.mjs): [{ fxId, t, x, y, from, to }].
export function pinRequests(video) {
  const out = [];
  for (const fx of video.effects || []) {
    const def = byType(fx.type);
    if (!def || fx.enabled === false) continue;
    const t = timingOf(fx, video);
    // Most pin one spot (fxId); a route pins several (fxId:0, fxId:1…).
    const list = def.pinPoints
      ? def.pinPoints(fx, video.duration).map((req, i) => ({ fxId: `${fx.id}:${i}`, req }))
      : [{ fxId: fx.id, req: pinRequest(fx, def, video.duration) }];
    for (const { fxId, req } of list) {
      if (req) out.push({ fxId, ...req, ...pinRange(req, t.start, t.end, video.duration) });
    }
  }
  return out;
}

// Whether the clip's people must be tracked (lib/tracking.mjs) before it can
// be composed: an effect follows someone.
export function needsTracking(video) {
  return (video.effects || []).some((fx) => fx.enabled !== false && byType(fx.type)?.needsTracks?.(fx));
}

// `brand` is the project's brand kit (lib/brand.mjs): its colours and fonts
// become CSS variables on #root, which effects reference.
export function compose(video, { bgFile, fgFile }, format = {}, brand = DEFAULT_BRAND) {
  const fmt = normaliseFormat(format);
  const kit = normaliseBrand(brand || DEFAULT_BRAND);
  const brandStyle = brandCss(kit);
  const canvas = canvasSize(fmt, video);
  const T = stageTransform(canvas, video, fmt, video.face);
  const duration = video.duration;

  // Stage effects see the source frame and which part of it is on screen;
  // canvas effects see the output frame.
  // Stage effects also get the clip's files: a copy of the cut-out can carry
  // a halo or play a little late (lib/effects-subject.mjs).
  const stageVideo = { ...video, view: T.view, brand: kit, files: { bg: bgFile, fg: fgFile } };
  const canvasVideo = {
    width: canvas.width, height: canvas.height, duration, hasAudio: video.hasAudio, face: null, brand: kit,
    captions: video.captions || null,
  };

  const built = [];
  for (const fx of video.effects || []) {
    if (fx.enabled === false) continue;
    const effect = byType(fx.type);
    if (!effect) continue;
    const space = spaceOf(effect, fx);
    const fragment = effect.build(fx, space === "canvas" ? canvasVideo : stageVideo);
    if (fragment) built.push({ fx, space, ...fragment });
  }

  const withMatte = built.some((f) => f.needsMatte) && Boolean(fgFile);
  // One effect may move the camera itself (lib/stage-motion.mjs): the first.
  const stageMotion = built.find((f) => f.stageMotion)?.stageMotion || null;
  const onStage = built.filter((f) => f.space === "stage");
  const onCanvas = built.filter((f) => f.space === "canvas");
  const join = (items, key) => items.map((f) => f[key]).filter(Boolean).join("\n");

  // Image treatments contribute CSS filters rather than markup. `footage`
  // reaches both video layers so the cut-out keeps matching the background;
  // `bg` reaches the background alone — which is how the blur leaves you sharp.
  const footageFilters = built.flatMap((f) => f.filters?.footage || []);
  const bgFilters = [...built.flatMap((f) => f.filters?.bg || []), ...footageFilters];
  // A blur samples past the element's edges and leaves them translucent; the
  // largest requested overscan hides that.
  const bgScale = Math.max(1, ...built.map((f) => f.bgScale || 1));

  // The stage's place on the canvas: CSS, or — when an effect moves the
  // camera — GSAP alone (it would overwrite a CSS transform anyway).
  const css = [`
      #stage {
        width: ${video.width}px; height: ${video.height}px;${stageMotion ? "" : `
        transform: translate(${r3(T.x)}px, ${r3(T.y)}px) scale(${r3(T.scale)});`}
      }`];
  if (bgFilters.length || bgScale > 1) {
    css.push(`      #bg {${bgFilters.length ? ` filter: ${bgFilters.join(" ")};` : ""}${
      bgScale > 1 ? ` transform: scale(${bgScale.toFixed(4)});` : ""} }`);
  }
  if (footageFilters.length && withMatte) {
    css.push(`      #fg { filter: ${footageFilters.join(" ")}; }`);
  }
  // Layers that stand in for the footage (a replaced background) take the same
  // grade, or the person and the scene behind them would not match.
  if (footageFilters.length) {
    css.push(`      .footage-layer { filter: ${footageFilters.join(" ")}; }`);
  }
  css.push(join(built, "css"));

  const media = (tag, id, src, extra = "") =>
    `<${tag} id="${id}" ${extra}
        data-start="0" data-duration="${duration}" data-media-start="0"
        src="media/${src}"${tag === "audio" ? ` data-volume="1"` : " muted"}></${tag}>`;

  // Bands: a blurred, zoomed copy of the footage, or a flat colour.
  const blurFill = fmt.fit === "contain" && fmt.fill === "blur";
  const background = fmt.fit === "contain" && fmt.fill !== "blur" ? fmt.fill : "#0a0a0a";

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${canvas.width}, height=${canvas.height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"><\/script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${canvas.width}px;
        height: ${canvas.height}px;
        overflow: hidden;
        background: ${background};
      }
${brandStyle.faces}
      #root {
        position: relative; width: 100%; height: 100%; overflow: hidden;
        ${brandStyle.vars}
        font-family: var(--font-body);
      }
      .clip { position: absolute; inset: 0; width: 100%; height: 100%; }
      #stage {
        position: absolute; left: 0; top: 0; z-index: 5;
        transform-origin: 0 0; overflow: hidden;
      }
      /* :where() — no weight: an effect's own #id rule must win (a halo at
         49 under the cut-out, a blurred layer at 52 above it). */
      :where(#stage video) { object-fit: cover; z-index: 1; }
      #stage #fg { z-index: 50; }
      #fill {
        object-fit: cover; z-index: 1;
        filter: blur(40px) brightness(0.6); transform: scale(1.15);
      }
${css.filter(Boolean).join("\n")}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${duration}"
      data-width="${canvas.width}"
      data-height="${canvas.height}"
    >
${blurFill ? `      ${media("video", "fill", bgFile, 'class="clip"')}` : ""}
      <div id="stage">
        ${media("video", "bg", bgFile, 'class="clip"')}
${join(onStage.filter((f) => f.layer === "behind"), "html")}
${withMatte ? `        ${media("video", "fg", fgFile, 'class="clip"')}` : ""}
${join(onStage.filter((f) => f.layer !== "behind"), "html")}
${join(onStage, "htmlFront")}
      </div>
${join(onCanvas, "html")}
${video.hasAudio ? `      ${media("audio", "audio", bgFile)}` : ""}
    </div>

    <script>
      // Setup runs before the timeline is ever seeked. Everything here is a
      // measurement of what the browser actually rendered, so it gives the same
      // answer on every run.${brandStyle.toLoad.length ? `
      // An imported font loads asynchronously: measuring before it arrives
      // would size the text in the fallback font. The renderer waits for
      // pending fonts, and this runs first once they are in.
      (function () {
        var setup = function () {
${join(built, "init")}
        };
        if (!document.fonts || !document.fonts.load) return setup();
        Promise.all([${brandStyle.toLoad.map((f) => `document.fonts.load('800 64px "${f}"'), document.fonts.load('500 64px "${f}"')`).join(", ")}])
          .then(setup, setup);
      })();` : `
${join(built, "init")}`}

      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
${join(built, "timeline")}${stageMotion ? `
      // The camera moves (reframe / stabilise): GSAP owns the stage's transform.
${stageTimeline(stageMotion, T, canvas, video)}` : ""}
      window.__timelines["main"] = tl;
      tl.seek(0);
    <\/script>
  </body>
</html>
`;
}

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

import { byType } from "./effects.mjs";
import { canvasSize, stageTransform, normaliseFormat } from "./format.mjs";
import { brandCss, normaliseBrand, DEFAULT_BRAND } from "./brand.mjs";

const r3 = (n) => Number(Number(n).toFixed(3));

export function buildEffects(video) {
  const built = [];
  for (const fx of video.effects || []) {
    if (fx.enabled === false) continue;
    const effect = byType(fx.type);
    if (!effect) continue;
    const fragment = effect.build(fx, video);
    if (fragment) built.push({ fx, space: effect.space || "stage", ...fragment });
  }
  return built;
}

export function needsMatte(video) {
  return buildEffects(video).some((f) => f.needsMatte);
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
  const stageVideo = { ...video, view: T.view, brand: kit };
  const canvasVideo = {
    width: canvas.width, height: canvas.height, duration, hasAudio: video.hasAudio, face: null, brand: kit,
    captions: video.captions || null,
  };

  const built = [];
  for (const fx of video.effects || []) {
    if (fx.enabled === false) continue;
    const effect = byType(fx.type);
    if (!effect) continue;
    const space = effect.space || "stage";
    const fragment = effect.build(fx, space === "canvas" ? canvasVideo : stageVideo);
    if (fragment) built.push({ fx, space, ...fragment });
  }

  const withMatte = built.some((f) => f.needsMatte) && Boolean(fgFile);
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

  const css = [`
      #stage {
        width: ${video.width}px; height: ${video.height}px;
        transform: translate(${r3(T.x)}px, ${r3(T.y)}px) scale(${r3(T.scale)});
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
      #stage video { object-fit: cover; z-index: 1; }
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
${join(built, "timeline")}
      window.__timelines["main"] = tl;
      tl.seek(0);
    <\/script>
  </body>
</html>
`;
}

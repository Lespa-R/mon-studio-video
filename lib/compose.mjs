// Turns a video entry + its effect stack into a HyperFrames composition.
//
// Pure: same input, same HTML. That is what keeps renders reproducible, and it
// means the composition can be regenerated at any time from the saved state.
//
// Layer stack, bottom to top:
//    1  the untouched footage
//   10  effects marked `behind`
//   50  the cut-out person  (only present when something sits behind it)
//   60  effects marked `front`
//   90  effects marked `top`

import { byType } from "./effects.mjs";

export function buildEffects(video) {
  const built = [];
  for (const fx of video.effects || []) {
    if (fx.enabled === false) continue;
    const effect = byType(fx.type);
    if (!effect) continue;
    const fragment = effect.build(fx, video);
    if (fragment) built.push({ fx, ...fragment });
  }
  return built;
}

export function needsMatte(video) {
  return buildEffects(video).some((f) => f.needsMatte);
}

export function compose(video, { bgFile, fgFile }) {
  const built = buildEffects(video);
  const withMatte = built.some((f) => f.needsMatte) && Boolean(fgFile);
  const duration = video.duration;

  const pick = (layer) => built.filter((f) => f.layer === layer);
  const join = (items, key) => items.map((f) => f[key]).filter(Boolean).join("\n");

  const behind = pick("behind");
  const front = pick("front");
  const top = pick("top");

  const css = join(built, "css");
  const init = join(built, "init");
  const timeline = join(built, "timeline");

  // Image treatments contribute CSS filters rather than markup. `footage`
  // applies to both video layers so the cut-out person keeps matching the
  // background; `bg` applies to the background alone, which is what lets the
  // background blur leave you sharp.
  const footageFilters = built.flatMap((f) => f.filters?.footage || []);
  const bgOnlyFilters = built.flatMap((f) => f.filters?.bg || []);
  const bgFilters = [...bgOnlyFilters, ...footageFilters];
  // A blur samples past the element's edges and leaves them translucent; the
  // largest requested overscan hides that.
  const bgScale = Math.max(1, ...built.map((f) => f.bgScale || 1));

  const footageCss = [
    bgFilters.length || bgScale > 1
      ? `      #bg {${bgFilters.length ? `\n        filter: ${bgFilters.join(" ")};` : ""}${
          bgScale > 1 ? `\n        transform: scale(${bgScale.toFixed(4)});` : ""
        }\n      }`
      : "",
    footageFilters.length && withMatte
      ? `      #fg { filter: ${footageFilters.join(" ")}; }`
      : "",
  ].filter(Boolean).join("\n");

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${video.width}, height=${video.height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"><\/script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${video.width}px;
        height: ${video.height}px;
        overflow: hidden;
        background: #0a0a0a;
      }
      #root {
        position: relative; width: 100%; height: 100%;
        font-family: -apple-system, "SF Pro Display", system-ui, sans-serif;
      }
      .clip { position: absolute; inset: 0; width: 100%; height: 100%; }
      /* Stacking is set per element in the effect CSS below:
         bg 1 · behind 10-11 · person 50 · front 60-62 · top 90 */
      #bg { object-fit: cover; z-index: 1; }
      #fg { object-fit: cover; z-index: 50; }
${footageCss}
${css}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${duration}"
      data-width="${video.width}"
      data-height="${video.height}"
    >
      <video id="bg" class="clip" data-start="0" data-duration="${duration}"
        data-media-start="0" data-track-index="0"
        src="media/${bgFile}" muted></video>
${video.hasAudio ? `
      <audio id="bg-audio" data-start="0" data-duration="${duration}"
        data-media-start="0" data-track-index="1" data-volume="1"
        src="media/${bgFile}"></audio>
` : ""}
${join(behind, "html")}
${withMatte ? `
      <video id="fg" class="clip" data-start="0" data-duration="${duration}"
        data-media-start="0" data-track-index="4"
        src="media/${fgFile}" muted></video>
` : ""}
${join(front, "html")}
${join(top, "html")}
    </div>

    <script>
      // Setup runs before the timeline is ever seeked. Everything here is a
      // measurement of what the browser actually rendered, so it gives the same
      // answer on every run.
${init}

      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
${timeline}
      window.__timelines["main"] = tl;
      tl.seek(0);
    <\/script>
  </body>
</html>
`;
}

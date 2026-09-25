// Turns shots — clips, trimmed, each with its own effect stack — into one
// HyperFrames composition, on a canvas of the requested format.
//
// Pure: same input, same HTML. That is what keeps renders reproducible, and it
// means the composition can be regenerated at any time from the saved state.
//
// Structure, per shot:
//
//   canvas (the output frame)
//   ├─ fill           blurred copy of the footage behind the bands, if any
//   ├─ stage          the source frame at its native size, moved onto the
//   │  │              canvas by one transform (see lib/format.mjs)
//   │  ├─  1 footage
//   │  ├─ 10 effects that sit behind the person
//   │  ├─ 50 the cut-out person      (only when something sits behind it)
//   │  └─ 55+ effects over the image
//   ├─ 62+ screen-anchored effects   (lower third, vignette, grain, bands, fade)
//   └─ 95 transition into this shot
//
// Every id a shot produces is prefixed with the shot's id, so the same clip can
// appear twice in a sequence without its elements colliding.
//
// Visibility: videos and audio are windowed by HyperFrames through their
// data-start / data-duration / data-media-start. Everything else spans the
// whole composition in data-*, and GSAP toggles `visibility` at the shot's
// edges — effects measure their own rendered text at load, which fails on an
// element the runtime has hidden, and `visibility` never fights the opacity
// the effects animate.

import { byType } from "./effects.mjs";
import { timingOf } from "./timing.mjs";
import { canvasSize, stageTransform, normaliseFormat } from "./format.mjs";

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

// A clip's effects are timed in clip time. A shot shows [in, out] of the clip,
// so each effect is re-expressed in shot time — and dropped if it falls
// entirely outside the cut.
function effectsForShot(video, cut) {
  const out = [];
  for (const fx of video.effects || []) {
    const t = timingOf(fx, video);
    const start = Math.max(t.start, cut.in);
    const end = Math.min(t.end, cut.out);
    if (end - start < 0.05) continue;
    out.push({ ...fx, start: start - cut.in, duration: t.full && cut.full ? null : end - start });
  }
  return out;
}

export const TRANSITIONS = [
  { value: "cut", label: "Coupe franche" },
  { value: "black", label: "Fondu au noir" },
  { value: "white", label: "Flash blanc" },
];

// shots:  [{ id, video, in, out, transition }]
// files:  video => { bgFile, fgFile }
export function composeSequence({ shots, format, files }) {
  const fmt = normaliseFormat(format);
  if (!shots.length) throw new Error("une séquence a besoin d'au moins un plan");

  const canvas = canvasSize(fmt, shots[0].video);

  // Lay the shots end to end.
  let clock = 0;
  const laid = shots.map((shot, index) => {
    const clip = shot.video.duration;
    const cutIn = r3(Math.min(Math.max(0, Number(shot.in) || 0), clip - 0.1));
    const cutOut = r3(Math.min(clip, Math.max(cutIn + 0.1,
      shot.out === null || shot.out === undefined ? clip : Number(shot.out))));
    const entry = {
      ...shot, index,
      sid: shot.id,
      start: r3(clock),
      in: cutIn,
      out: cutOut,
      duration: r3(cutOut - cutIn),
      full: cutIn === 0 && cutOut === r3(clip),
    };
    clock += entry.duration;
    return entry;
  });
  const total = r3(clock);

  const css = [];
  const markup = [];
  const inits = [];
  const timeline = [];
  let rootBackground = "#0a0a0a";

  for (const shot of laid) {
    const { sid, video, start, duration } = shot;
    const { bgFile, fgFile } = files(video);
    const T = stageTransform(canvas, video, fmt, video.face);
    const first = shot.index === 0;

    // What the effects see: the clip, trimmed, and which part of it is on screen.
    const stageVideo = {
      ...video,
      duration,
      domDuration: total,
      view: T.view,
      effects: effectsForShot(video, shot).map((fx) => ({ ...fx, id: `${sid}_${fx.id}` })),
    };
    const canvasVideo = {
      width: canvas.width, height: canvas.height, duration, domDuration: total,
      hasAudio: video.hasAudio, face: null,
    };

    // Each effect is built in the space it belongs to.
    const built = [];
    for (const fx of stageVideo.effects) {
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
    const bgScale = Math.max(1, ...built.map((f) => f.bgScale || 1));

    css.push(`
      /* ---- shot ${shot.index + 1} · ${sid} */
      #stage_${sid} {
        width: ${video.width}px; height: ${video.height}px;
        transform: translate(${r3(T.x)}px, ${r3(T.y)}px) scale(${r3(T.scale)});
      }`);
    if (bgFilters.length || bgScale > 1) {
      css.push(`      #bg_${sid} {${bgFilters.length ? ` filter: ${bgFilters.join(" ")};` : ""}${
        bgScale > 1 ? ` transform: scale(${bgScale.toFixed(4)});` : ""} }`);
    }
    if (footageFilters.length && withMatte) {
      css.push(`      #fg_${sid} { filter: ${footageFilters.join(" ")}; }`);
    }
    css.push(join(built, "css"));
    if (!first) {
      // Shots after the first start hidden; the timeline reveals them.
      css.push(`      #stage_${sid}, [id^="${sid}_"] { visibility: hidden; }`);
    }

    const media = (id, src, extra = "") =>
      `<${id.startsWith("audio") ? "audio" : "video"} id="${id}" ${extra}
        data-start="${start}" data-duration="${duration}" data-media-start="${shot.in}"
        src="media/${src}"${id.startsWith("audio") ? ` data-volume="1"` : " muted"}></${
          id.startsWith("audio") ? "audio" : "video"}>`;

    // Bands: a blurred, zoomed copy of the footage, or a flat colour.
    if (fmt.fit === "contain") {
      if (fmt.fill === "blur") {
        markup.push(`      ${media(`fill_${sid}`, bgFile, 'class="clip fill"')}`);
      } else if (first) {
        rootBackground = fmt.fill;
      }
    }

    markup.push(`
      <div class="stage" id="stage_${sid}">
        ${media(`bg_${sid}`, bgFile, 'class="clip"')}
${join(onStage.filter((f) => f.layer === "behind"), "html")}
${withMatte ? `        ${media(`fg_${sid}`, fgFile, 'class="clip fg"')}` : ""}
${join(onStage.filter((f) => f.layer !== "behind"), "html")}
      </div>
${join(onCanvas, "html")}`);

    if (video.hasAudio) markup.push(`      ${media(`audio_${sid}`, bgFile)}`);

    // Transition into this shot.
    if (!first && shot.transition && shot.transition !== "cut") {
      const colour = shot.transition === "white" ? "#ffffff" : "#000000";
      const prev = laid[shot.index - 1];
      const half = r3(Math.min(0.25, prev.duration / 2, duration / 2));
      css.push(`      #tr_${sid} { z-index: 95; background: ${colour}; opacity: 0; pointer-events: none; }`);
      markup.push(`      <div id="tr_${sid}" class="clip" data-start="0" data-duration="${total}"></div>`);
      timeline.push(`
      tl.fromTo("#tr_${sid}", { opacity: 0 },
        { opacity: 1, duration: ${half}, ease: "power1.in" }, ${r3(start - half)});
      tl.to("#tr_${sid}", { opacity: 0, duration: ${half}, ease: "power1.out" }, ${start});`);
    }

    inits.push(join(built, "init"));

    // The shot's own animations, written against a `tl` that starts at 0, are
    // nested at the shot's position in the root timeline.
    const shotTimeline = join(built, "timeline");
    if (shotTimeline.trim()) {
      timeline.push(`
      (function (root) {
        var tl = gsap.timeline();${shotTimeline}
        root.add(tl, ${start});
      })(tl);`);
    }

    // Show this shot's elements only during its own window.
    const sel = `#stage_${sid}, [id^="${sid}_"]`;
    if (!first) timeline.push(`      tl.set('${sel}', { visibility: "visible" }, ${start});`);
    if (r3(start + duration) < total) {
      timeline.push(`      tl.set('${sel}', { visibility: "hidden" }, ${r3(start + duration)});`);
    }
  }

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
        background: ${rootBackground};
      }
      #root {
        position: relative; width: 100%; height: 100%; overflow: hidden;
        font-family: -apple-system, "SF Pro Display", system-ui, sans-serif;
      }
      .clip { position: absolute; inset: 0; width: 100%; height: 100%; }
      .stage {
        position: absolute; left: 0; top: 0; z-index: 5;
        transform-origin: 0 0; overflow: hidden;
      }
      .stage video { object-fit: cover; z-index: 1; }
      .stage video.fg { z-index: 50; }
      video.fill {
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
      data-duration="${total}"
      data-width="${canvas.width}"
      data-height="${canvas.height}"
    >
${markup.join("\n")}
    </div>

    <script>
      // Setup runs before the timeline is ever seeked. Everything here is a
      // measurement of what the browser actually rendered, so it gives the same
      // answer on every run.
${inits.filter(Boolean).join("\n")}

      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
${timeline.join("\n")}
      window.__timelines["main"] = tl;
      tl.seek(0);
    <\/script>
  </body>
</html>
`;
}

// One clip on its own: a sequence of a single, untrimmed shot.
export function compose(video, { bgFile, fgFile }, format = {}) {
  return composeSequence({
    shots: [{ id: "s0", video, in: 0, out: null, transition: "cut" }],
    format,
    files: () => ({ bgFile, fgFile }),
  });
}

// Which clips of a sequence need their cut-out built before it can play.
export function clipsNeedingMatte(shots) {
  const seen = new Map();
  for (const { video } of shots) {
    if (!seen.has(video.id) && needsMatte(video)) seen.set(video.id, video);
  }
  return [...seen.values()];
}

export function sequenceDuration(shots) {
  return r3(shots.reduce((sum, s) => {
    const clip = s.video.duration;
    const cutIn = Math.min(Math.max(0, Number(s.in) || 0), clip - 0.1);
    const cutOut = Math.min(clip, Math.max(cutIn + 0.1, s.out == null ? clip : Number(s.out)));
    return sum + (cutOut - cutIn);
  }, 0));
}

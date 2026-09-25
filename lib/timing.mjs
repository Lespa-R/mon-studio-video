// Where an effect instance sits on the clip.
//
// Its own module so both catalogues can use it without importing each other.

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const r3 = (n) => Number(n.toFixed(3));

export function timingOf(fx, video) {
  const clip = video.duration;
  const start = Math.min(Math.max(0, num(fx.start, 0)), Math.max(0, clip - 0.1));
  const requested =
    fx.duration === null || fx.duration === undefined
      ? clip - start
      : num(fx.duration, clip - start);
  const duration = Math.max(0.1, Math.min(requested, clip - start));
  return {
    start: r3(start),
    duration: r3(duration),
    end: r3(start + duration),
    // True when the instance covers the entire clip, so effects can skip the
    // in/out ramps that would otherwise show as a flicker at the very edges.
    full: start <= 0.001 && start + duration >= clip - 0.001,
  };
}

// Fade a full-frame overlay in and out around its window. Returns GSAP calls;
// the element is expected to start at opacity 0 in CSS.
export function overlayTimeline(selector, t, opacity, ramp = 0.3) {
  const fadeIn = t.full ? 0.001 : ramp;
  const fadeOut = t.full ? 0.001 : ramp;
  const outAt = Math.max(t.start + fadeIn, t.end - fadeOut);
  return `
      tl.fromTo("${selector}", { opacity: 0 },
        { opacity: ${opacity}, duration: ${fadeIn}, ease: "power1.out" }, ${t.start});
      tl.to("${selector}", { opacity: 0, duration: ${fadeOut}, ease: "power1.in" }, ${r3(outAt)});`;
}

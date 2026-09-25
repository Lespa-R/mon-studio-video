# Mon Studio HyperFrame — notes for Claude

A local web studio that adds HyperFrames elements to video clips: text passing
behind the person (via a per-frame cut-out), titles, lower thirds, image
treatments, rendered to MP4 in a chosen output format. Single user, runs on
macOS. The user is **francophone**: talk to him in French, keep every UI string
in French.

The usual request here is **"add a new element / effect"**. That is one object
in `lib/effects.mjs` (graphics) or `lib/effects-image.mjs` (image treatments) —
see [Adding an effect](#adding-an-effect). Everything else follows.

## Run and verify

```bash
npm run studio   # checks prerequisites, starts, opens http://localhost:3002
npm start        # server only
npm test         # node --test, no dependencies — must stay green
npm run check    # HyperFrames lint of index.html (= last rendered composition)
```

- **Restart the server after changing anything in `lib/` or `server/`.** Node
  caches modules: a render will silently use the old code. `server/ui/index.html`
  is read from disk on every request — a reload is enough.
- **Test on an isolated copy, not the user's running studio.** Copy the code to a temp dir and run it on another port (`node server/server.mjs 3102`) — it gets its own `studio.json` and `media/`. Creating a project in his live studio once switched what his open tab showed and lost an image he was choosing.
- **Throwaway projects, never the user's.** Create one through the API,
  upload `~/Desktop/Hello World.mov` (a 3 s talking-head clip), test, then
  `DELETE /api/projects/:id` (removes its media) and re-activate his project.
  Delete test renders from `renders/`.
- API calls from a script need `Origin: http://localhost:3002` (or no Origin):
  anything else is refused by the Host/Origin guard.
- To check a render, extract frames: `ffmpeg -i out.mp4 -vf "select='eq(n\,30)',scale=640:-1,tile=4x1" …`
  and look at them. Audio: `ffmpeg -i out.mp4 -af volumedetect -f null -`.

## Map

```
server/server.mjs      HTTP + JSON API, zero dependencies; preview player; render queue
server/ui/index.html   the whole UI (vanilla JS, no build)
lib/effects.mjs        graphics effects + registry          ← add effects here
lib/effects-image.mjs  image treatments (filters, grain…)   ← or here
lib/compose.mjs        clip + effects + format → HyperFrames HTML (pure)
lib/format.mjs         output canvas, and how the clip is placed on it (pure)
lib/timing.mjs         an effect's window on the clip (pure)
lib/store.mjs          studio.json: folders → projects (+format) → clips → effects; presets
lib/media.mjs          ffprobe, face detection, person matte (async)
lib/guard.mjs          Host/Origin guard
tools/*.swift          Vision helpers: facedet (face box), personmatte (cut-out → RGBA)
bin/behind.mjs         one-shot CLI
test/*.test.mjs        node --test
docs/ARCHITECTURE.md   the long-form technical reference
```

## Adding an effect

Append an object to `EFFECTS` (or `IMAGE_EFFECTS`). The `schema` drives the UI
controls on its own; the catalogue endpoint and the picker pick it up. Nothing
else to wire.

```js
{
  type: "my-effect",            // stable id, stored in studio.json
  label: "Mon effet",           // French, shown in the UI
  hint: "Ce qu'il fait.",
  needsMatte: false,            // true if it must sit behind the person
  timed: true,                  // false = whole clip (e.g. CSS filters)
  space: "stage",               // "stage" (moves with the footage) or "canvas" (output frame)
  layer: "front",               // "behind" (under the cut-out) | "front" | "top"
  needsFace: false,             // true only if placed from the face box (behind-text)
  schema: [{ key, label, type: "text|color|number|range|select|image", default,
             showIf: { key: "mode", values: ["image"] } /* optional */ }],
  build(fx, video) {            // → { layer, needsMatte, css, html, init, timeline } or null
    const t = timingOf(fx, video);           // { start, duration, end, full }
    ...
  },
}
```

Rules that keep compositions correct:

- **Ids come from `fx.id`**; prefix every class/id you generate with it.
- **Declare elements for the whole clip** (`data-start="0"
  data-duration="${video.duration}"`) and let GSAP decide visibility. `init`
  scripts measure rendered text, which fails on an element the runtime hides.
  Start hidden in CSS (`opacity: 0`) and animate in with `tl.fromTo` at `t.start`.
- **Finish inside the window.** A staggered exit lasts `exit + stagger × (n−1)`;
  `textTimeline()` already compresses entrance + exit to fit short windows.
- **Stage vs canvas.** Stage effects are in source pixels and should use
  `video.view` (the visible part after a recrop) for widths and on-screen
  positions — see `viewOf()` and `fitAndPlace()`. Canvas effects get the output
  frame as `video`; size them on `Math.min(width, height)`.
- **Anything embedded in a `<script>` goes through `jsString()`**, and anything
  in HTML/CSS through `esc()`.
- **Deterministic only**: no `Math.random`, no `Date.now`, no infinite GSAP
  repeats (they give the root timeline an infinite duration). Grain uses a
  fixed-seed `feTurbulence` + a stepped tween.
- **Field types.** `image` uploads to `POST /api/assets` and stores the returned
  name (`asset_<hex>.png|jpg|webp`); validate it with `ASSET_NAME` before using
  it in markup. `showIf` hides a field unless another param has one of the
  listed values — the UI and the library editor both honour it.
- **Layers that stand in for the footage** (like `bg-replace`) get the class
  `footage-layer`: `compose.mjs` gives them the clip's grade.
- **z-index**: bg 1 · replaced background 2 · behind 10–11 · cut-out 50 · tint 55 · front 60–62 ·
  vignette 80 · grain 82 · bands 88 · fade 90.
- Image treatments return `filters: { footage: [...], bg: [...] }` instead of
  markup; `compose.mjs` concatenates them per layer.

Then: a test in `test/compose.test.mjs` (at least "builds for a typical clip",
covered by the catalogue smoke test), a real render checked frame by frame, and
a line in the README's effect table.

The HyperFrames catalogue (`npx hyperframes@0.8.75 catalog`) has ~400 blocks —
lower thirds, transitions, captions, light leaks — worth reading for ideas;
effects here are reimplemented so they stay deterministic and fit the stage /
canvas model.

## Gotchas already paid for

- **Never use `prompt()`, `confirm()` or `alert()`.** The Claude desktop browser
  pane throws on `prompt()` and answers `confirm()` with `false` — it broke
  preset creation and silently cancelled every deletion. Use `dialog()`,
  `askText()`, `askConfirm()` in the UI.
- **Two top-level functions with the same name**: the second silently wins.
  `drawLibrary` (clip list) vs `drawEffectLibrary` (library page) — keep them
  distinct.
- **`display: flex/grid` beats the `hidden` attribute.** Add `[hidden] { display: none }`
  for any element you toggle.
- **Backslashes inside the preview player's template literal are eaten** (`\d`
  becomes `d`). Avoid regexes there.
- **Screenshots of a playing `<video>` come out black** (or on top of overlays):
  Chrome's hardware overlay. Check the DOM, `elementFromPoint`, or a render.
- **`npm run check` always reports `text_occluded`** (the linter thinks the
  cut-out video is opaque) **and contrast errors** (it ignores the scrim).
  Both are false positives. `Lint`, `Runtime`, `Motion` must stay clean, and
  `content_overlap` means a real timing bug.

## Decisions — do not revisit without being asked

- **No shot sequencing.** Chaining several shots into one video was built, then
  removed at the user's request (2026-09-25). One clip → one render.
- **Local first.** No accounts, no cloud; the server listens on 127.0.0.1 only.
- **Zero runtime dependencies.** No `npm install`, no build step.
- **Private GitHub repo**: `Lespa-R/mon-studio-hyperframe`. `studio.json`,
  `media/`, `renders/` are never committed.

# Mon Studio Vidéo — notes for Claude

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
  caches modules: a render will silently use the old code. The UI files
  (`server/ui/*`) are read from disk on every request — a reload is enough.
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
server/server.mjs      HTTP + JSON API, zero dependencies; render queue
server/storage.mjs     Storage page API: scan, delete (names only), reveal
server/player.mjs      the in-page preview player wrapped around a composition
server/promos.mjs      « Promos » tab: Remotion promos driven through the promo-site skill (see below)
server/loopback.cjs    preloaded into Remotion Studio so it listens on 127.0.0.1 only
server/ui/index.html   markup; styles.css; app-*.js = classic scripts sharing one
                       global scope, loaded in order (no build, no modules):
                       core (dialogs, clips, inspector, preview, timeline) · storage ·
                       trim · textcut (montage par le texte) · shots (rush → plans) ·
                       object (objet choisi, SAM 2) · editor (subtitles, drag, projects, presets) · library ·
                       promos · pages (tabs, format, brand) · main (wiring, layout, boot) ·
                       fcp (Final Cut habits: timecode, skimming, zoom, areas,
                       effects browser, waveform, shortcuts)
lib/effects.mjs        text effects, TEXT_ANIMS + registry  ← add effects here
lib/effects-anim.mjs   animated elements (canvas space)     ← or here
lib/effects-image.mjs  image treatments (filters, grain…)   ← or here
lib/effects-captions.mjs the "Sous-titres" effect (draws video.captions)
lib/effects-people.mjs name tags that follow each tracked person
lib/effects-subject.mjs on the cut-out: halo, colour pop, pop-out frame, motion echo
lib/effects-follow.mjs  follow a « Sujet »: spotlight, follow tag, tracker, orbit text
lib/effects-camera.mjs  move the stage: reframe (follow the subject), stabilise (lock a spot)
lib/effects-scene.mjs   pinned to the scenery: sun flare, route (several pins)
lib/effects-blur.mjs    « Flouter »: blurred / pixelated layer over a followed object or the people
lib/follow.mjs         « Sujet » (person / group / object / pin / fixed) → one path of boxes + GSAP helpers (pure)
lib/stage-motion.mjs   the stage moving over time (reframe, stabilise) → GSAP on #stage (pure)
lib/tracking.mjs       detections → one smooth track per person; follow paths (pure)
lib/trim.mjs           trimming: shift effects / subtitles when the cut moves (pure)
lib/textcut.mjs        montage par le texte: transcript tokens, removed passages, time maps,
                       Whisper output parsing (pure, no imports — the UI loads it too, as a module)
lib/history.mjs        undo / redo of a clip's effects, subtitles, cut-out choice (in memory)
lib/objects.mjs        « Objet choisi »: cut-out choices, clicked-object options (pure)
lib/pins.mjs           « Fixé dans le décor »: pinned spots, track → GSAP mover tweens (pure)
lib/keyframes.mjs      sampled path → GSAP: RDP simplify, 1 ms-short spans, steady sight, sight fades (pure)
lib/util.mjs           helpers every effect module imports: esc, jsString, num, clamp, r1, r3, viewOf, unitOf, shortHash
lib/shots.mjs          splitting a rush into shots: shot list clean-up, clip names (pure)
lib/storage.mjs        disk usage: sorts every file into a kind, says what may be deleted (pure)
lib/captions.mjs       subtitles: words → lines, edits, SRT in/out, chunking (pure)
lib/brand.mjs          brand kits: colour tokens, fonts, logo (pure)
lib/compose.mjs        clip + effects + format → HyperFrames HTML (pure)
lib/format.mjs         output canvas, and how the clip is placed on it (pure)
lib/timing.mjs         an effect's window on the clip (pure)
lib/store.mjs          studio.json (v6): folders → projects (+format, brandId) → clips → effects; presets; brands; fonts
lib/media.mjs          ffprobe, face detection, person matte, Whisper transcription, cuts (async)
lib/guard.mjs          Host/Origin guard
lib/promos.mjs         promos: scene catalogue, storyboard validation, timing, warnings, brand.json (pure)
tools/*.swift          Vision helpers: facedet (face box), personmatte (cut-out → RGBA);
                       transcribe.swift → tools/Transcribe.app (on-device speech → timed words);
                       persontrack (bodies + faces, several people, N samples/s)
tools/objtrack.py      SAM 2.1 follows a clicked object → grey mask video (personmatte --mask-video)
tools/sam_worker.py    SAM 2.1 resident worker: instant mask for the object dialog's clicks
tools/scenetrack.py    OpenCV follows a spot of the scenery (KLT + SIFT landmark) for pinned text
tools/scenes.py        PySceneDetect shot detection, run with .venv/bin/python (Python 3.12)
bin/behind.mjs         one-shot CLI
test/*.test.mjs        node --test
docs/ARCHITECTURE.md   the long-form technical reference
```

## Adding an effect

Append an object to `EFFECTS`, `ANIM_EFFECTS` or `IMAGE_EFFECTS`. The `schema`
drives the UI controls on its own; the catalogue endpoint and the picker pick it
up, grouped by `category` ("Textes", "Animations", "Image"). Nothing else to
wire.

```js
{
  type: "my-effect",            // stable id, stored in studio.json
  label: "Mon effet",           // French, shown in the UI
  hint: "Ce qu'il fait.",
  needsMatte: false,            // true if it must sit behind the person
  timed: true,                  // false = whole clip (e.g. CSS filters)
  space: "stage",               // "stage" (moves with the footage) or "canvas" (output frame)
  layer: "front",               // "behind" (under the cut-out) | "front" | "top"
  needsFace: false,             // true only if it cannot work without the face box (none do today)
  drag: { key: "position" },    // optional: draggable on the preview (see below)
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
  in HTML/CSS through `esc()` — both from `lib/util.mjs`, with `num`, `clamp`,
  `r1`, `r3`, `viewOf`, `unitOf`: import them, never redefine them.
- **Deterministic only**: no `Math.random`, no `Date.now`, no infinite GSAP
  repeats (they give the root timeline an infinite duration). Grain uses a
  fixed-seed `feTurbulence` + a stepped tween.
- **Field types.** `image` uploads to `POST /api/assets` and stores the returned
  name (`asset_<hex>.png|jpg|webp`); validate it with `ASSET_NAME` before using
  it in markup. `showIf` hides a field unless another param has one of the
  listed values — the UI and the library editor both honour it.
- **Layers that stand in for the footage** (like `bg-replace`) get the class
  `footage-layer`: `compose.mjs` gives them the clip's grade.
- **z-index**: bg 1 · replaced background 2 · behind 10–11 · cut-out 50 · tint 55 · front 60–62 · animations 63–68 · logo 84 · progress 86 ·
  vignette 80 · grain 82 · bands 88 · fade 90. A `<video>` on the stage gets
  1 from `:where(#stage video)`, which weighs nothing: its own `#id` rule wins.
- Image treatments return `filters: { footage: [...], bg: [...] }` instead of
  markup; `compose.mjs` concatenates them per layer.
- **Brand kit.** Colour params default to tokens (`"brand:primary"`, `"brand:text"`…)
  and go through `paint()` / `paintAlpha()` from `lib/brand.mjs` — never raw into
  CSS. Text uses `font-family: var(--font-title)` or `var(--font-body)`. The kit
  itself reaches `build()` as `video.brand` (the logo effect reads its `logo`).
- **Dragging on the preview.** `drag: { key }` means a drop sets
  `params[key] = "free"` plus `x` / `y` (% of the frame) = the box's new centre;
  `drag: { delta: true }` adds the move to `x` / `y` (the arrow's target).
  `drag: { key, stage: true }` is for stage effects (behind-text, title): x / y
  are % of the *source* frame, and the element carries `data-anchor-x/-y`. Mark
  the grabbable box(es) with `data-drag="${id}"`, give the position select a
  `"free"` option and the `freeXY(key)` fields, and centre on
  `freeSpot(p)` in free mode (see `lib/effects-anim.mjs`).
- **Following people.** An effect that needs tracks declares
  `needsTracks(fx) → bool`; the server then runs `ensureTracks()` (cached in
  `media/<id>-people.json`) before previewing or rendering, and `build()` finds
  them in `video.people`. Use `followPath()` + `simplifyPath()` +
  `pathTimeline()` from `lib/tracking.mjs` on a *mover* wrapper, and animate the
  element inside it. `drag: { offset: true }` (or `follow: "<anchor value>"`)
  makes a drag write `ox` / `oy` offsets instead of a fixed position.
- **Pinned to the scenery.** `pin: { key }` on the effect (or `pin: {}` for
  one that is always pinned) + a `PIN_OPTION` in that select + `pinFields()`;
  x / y are where the spot was at `params.pinAt` (null = the effect's start).
  The server follows each spot (`ensurePins`, `media/<id>-pin-<key>.json`) and
  `build()` finds the track in `video.pins[fx.id]`: wrap the element with
  `pinWrap()` (a mover with its transform-origin on the spot, plus an
  `-anchor` marker the preview reads on a drop) and animate it with
  `pinTimeline(pinnedPath(video, fx.id, t, p.pinFollow), anchor)`.
  `drag: { pin: "<value>" }` (or `pin: true`) makes a drop re-pin it where it
  lands, at that moment. Moments in params (`pinAt`, `pinAt0`…, an object's
  `t`) move with a trim (`shiftForTrim`) and are reset when the effect goes
  to another clip (`portableParams`: presets, pastes).
- **Placement vs animation transforms**: put a `translate(-50%)` centring on a
  wrapper and tween the child — a GSAP `x`/`y` tween overwrites the transform.

Then: a test in `test/compose.test.mjs` (at least "builds for a typical clip",
covered by the catalogue smoke test), a real render checked frame by frame, and
a line in the README's effect table. `test/timelines.test.mjs` runs every
effect's timeline against a recorder — whole clip, normal and very short
windows, every value of the selects that shape it: no two tweens of one
element may fight over a property, none may run past the window. Add a select
there if a new one changes the timeline's shape.

The HyperFrames catalogue (`npx hyperframes@0.8.75 catalog`) has ~400 blocks —
lower thirds, transitions, captions, light leaks — worth reading for ideas;
effects here are reimplemented so they stay deterministic and fit the stage /
canvas model.

## Promos (Remotion)

A second production type, next to clips + HyperFrames effects: website promos
in motion design. The studio does **not** embed Remotion. It drives the skill
`promo-site` (`~/.claude/skills/promo-site`, override `PROMO_SKILL_DIR`): its
`template/` is the Remotion engine copied into each promo, its `scripts/` do the
work (`new_promo.sh`, `capture_site.sh`, `parse_site.py`, `prepare_logo.py`,
`check_render.sh`, `render.sh`). Promos live in `~/Code/promos/<slug>/`
(override `PROMOS_DIR`), which holds the only npm install.

- The storyboard (`storyboard.json`) is the single source of truth for image
  *and* music: scene `bars` and `energy` drive `music/compose.py` and the
  engine's beat sync. `lib/promos.mjs › SCENE_TYPES` mirrors the engine's
  scene props — **a new scene in the skill needs its entry there** (fields
  drive the form, like effect schemas).
- Renders go through the studio's single render queue (`inRenderQueue`).
  Scripts run with `PROMO_LOG=info` so Remotion prints `Rendered n/N` progress.
- `/promos/<slug>/…` serves only a whitelist (`SERVABLE`): sheet, renders,
  screenshot, logo. Slugs are checked against `SLUG`.
- Deleting (`DELETE /api/promos/:slug`, `DELETE …/renders/:name`) moves to
  `~/.Trash` (`toTrash`), never `rm`: Robin can put it back.
- A promo's files are outside `ROOT`, so the Storage page ignores them;
  « Ajouter au montage » copies a render into `media/` as an ordinary clip.
- Test with `PROMOS_DIR=<temp copy>` (symlink its `node_modules` to
  `~/Code/promos/node_modules`) on the isolated studio copy.

## Montage = Final Cut Pro layout (asked for by the user, 2026-09-29)

Robin knows Final Cut Pro best: the montage mirrors it. Browser (projects +
clip thumbnails) | viewer (transport, timecode) | inspector (Effets ·
Sous-titres · Projet = output format and brand) on top; the timeline across
the whole width below, with the effects browser (⌘5) on its right. The clip
is the primary storyline (filmstrip + waveform, drawn in the browser, nothing
on disk); timed effects are connected clips coloured by family (Textes violet,
Animations rose, Image sarcelle); whole-clip effects are badges on the clip;
subtitles are the top lane. A new timed effect lands at the playhead.
Skimming (S), J/K/L, arrows, ⌘±/⇧Z zoom, ⌘4 / ⌃⌘1 / ⌃⌘2 areas, V, ⌫, ⌘E,
⌘I — keep to Final Cut's shortcuts when adding one, and list it in
`SHORTCUTS` (app-fcp.js), which « ⌨ Raccourcis » / ? shows.
`test/ui.test.mjs` opens every tab in a headless Chrome and fails on any
script error: run `npm test` after touching the UI.

## Objet choisi (SAM 2)

`matteOptions = { model: "person" | "subject" | "none", object: { t, points, level } }`.
With an object, `ensureMatte` first runs `ensureObjectMask` (objtrack.py →
`media/<id>-object.mp4`, kept while `objectSignature` matches), then
personmatte merges it with the person (`--mask-video`, `--model none` for the
object alone, window 1 since SAM 2 is already steady). For a single click
SAM 2 proposes three nested masks and its "confidence" favours the smallest
(one banana): the user picks the size (`level` 0/1/2, `sam_worker.pick`), and
objtrack seeds the video tracking with that same image mask — what the dialog
shows is what is followed. bfloat16 on MPS halves the time; clips over 40 fps
are tracked every other frame; 150-frame chunks bound memory. The dialog shows
a still frame (`GET …/frame?t=&w=`), not a <video>: a video under an overlay
can show black in Chrome. A trim maps the clicked time through the cut, or
drops the object if its frame was cut away. **Install sam2 from Meta's
GitHub, never PyPI's "sam2"** (a third-party fork).

## Effets de suivi (2026-10-06)

Family « Suivi » (amber). Shared pieces:
- **« Sujet »** (`lib/follow.mjs`): `sourceFields()` + `followBoxes(fx, video, t)`
  → `[{ t, x, y, w, h, seen }]` whatever is followed — people (`video.people`,
  `needsTracks: followsPeople`), an object clicked *in the effect*
  (`params.object`, field type `object` in the inspector, the object dialog
  with a `target`; `ensureObjects` runs objtrack with `--boxes` and caches
  `media/<id>-obj-<key>.mp4|json` → `video.objects`), a pin, a fixed point.
  `boxTimeline` / `sizeTimeline` / `boxTweens` animate a mover and a box
  (the spotlight tweens its oval as CSS variables `--rx` / `--ry`: a pane
  scaled down with a shrinking subject stopped covering the frame). Every
  follow effect puts an `-anchor` marker on its subject in the mover: a drop
  in « point du décor » mode re-pins there. `drag.only` limits handles to the
  modes where a drag means something.
- **The cut-out as material**: `video.files.fg` lets an effect copy the fg
  video — a drop-shadow halo under it (z 49), delayed copies for the echo
  (`data-start` k × gap, `data-media-start` = window start). Colour pop is a
  `backdrop-filter` pane at z 9 (scenery only, not the text at 10–11).
- **Two layers from one effect**: `htmlFront` goes in front of the cut-out
  (orbit text: back half behind, front half before).
- **Dynamic space**: `effect.space` may be a function of fx — arrow, circle,
  emoji, counter go on the stage when pinned (`attach` / `position` = "pin").
- **Stage motion** (`stageMotion` from build, first one wins): compose emits
  GSAP on `#stage` (x, y, scale, origin 0 0) via `stage-motion.mjs`, clamped
  so no edge shows; ramps in and out of the window.
- **Several pins**: `def.pinPoints(fx)` → `video.pins["<fxId>:<i>"]`; the
  preview gives each `data-drag-pt` element its own handle.
- **Blur**: ffmpeg makes the layer once (`makeBlurLayer`: blurred / pixelated
  / black, alphamerge with the widened mask) → `media/<id>-blur-<key>.webm`;
  laid at z 52, above the cut-out, graded like the footage (`footage-layer`).
- **Order before a preview or a render** (`ensureEffectData` in server.mjs):
  people's tracks, scenery pins, objects, the cut-out, blur layers (a blur of
  the people is made from the cut-out, keyed by its signature). A render
  composes its snapshot, which takes the live clip's new matte signature.
- **Preview-only guides**: class `studio-guide` (stabilise's crosshair) is
  opacity 0 in the export, made visible by server/player.mjs.
- **Lint**: movers, rings and panes that travel past the frame on purpose
  carry `data-layout-allow-overflow`; one element's attributes are tweened in
  one series (the lint counts every `attr` as one property: a route line
  tweens x1 y1 x2 y2 together); with a moving camera `#stage` has no CSS
  transform (GSAP places it from 0: HyperFrames' static guard flags a CSS
  transform that GSAP also animates).

## Fixé dans le décor (scenetrack)

The text must stay on a spot of the *scenery*, so nothing but the spot's
surroundings moves it: a background median is pulled by the ground close to
a walking camera (it moves much faster), and corners along a ridge or a
horizon say nothing reliable about a turn. Two layers: frame-to-frame KLT
around the spot (median move, smooth) and, every 4 frames — every other one
while lost — the spot as it looked at `pinAt` found again with SIFT + RANSAC
(ORB failed after a 12 s detour and a 30° roll; SIFT at 960 px did not). The
landmark eases drift away, gives zoom and turn without accumulating error,
and brings the text back when the camera returns. Frames are streamed
(backwards in 90-frame chunks), so memory does not grow with the clip.
Visibility runs under 0.35 s are merged (`steadySight`), or the text blinks;
keyframe durations are 1 ms short (`span`), or float rounding makes tweens
touch — both in `lib/keyframes.mjs`, shared with the people's paths and the
camera.

## Undo

Every non-GET request on `/api/videos/:id/(effects|captions|matte)` is
recorded by `history.remember()` in server.mjs **before** the route runs —
a new clip-editing route under those paths is undoable for free; one
elsewhere is not. Trims forget the clip's history (its times changed).
The UI calls `flushPatches()` before undoing so a debounced edit is not
lost behind the step.

## Gotchas already paid for

- **Never use `prompt()`, `confirm()` or `alert()`.** The Claude desktop browser
  pane throws on `prompt()` and answers `confirm()` with `false` — it broke
  preset creation and silently cancelled every deletion. Use `dialog()`,
  `askText()`, `askConfirm()` in the UI.
- **Two top-level functions with the same name**: the second silently wins.
  `drawLibrary` (clip list) vs `drawEffectLibrary` (library page) — keep them
  distinct.
- **`display: flex/grid` beats the `hidden` attribute.** Add `[hidden] { display: none }`
  for any element you toggle. A page view is a `<main>`: `main[hidden]` is
  `!important` because a view with its own `display` (`main.storage`) once
  stayed on screen, hidden, and halved the montage preview.
- **Backslashes inside the preview player's template literal are eaten** (`\d`
  becomes `d`). Avoid regexes there.
- **Screenshots of a playing `<video>` come out black** (or on top of overlays):
  Chrome's hardware overlay. Check the DOM, `elementFromPoint`, or a render.
- **`npm run check` always reports `text_occluded`** (the linter thinks the
  cut-out video is opaque) **and contrast errors** (it ignores the scrim).
  Both are false positives. `Lint`, `Runtime`, `Motion` must stay clean, and
  `content_overlap` means a real timing bug.

- **GSAP reads a CSS `translate(-101%)` back as pixels** and adds its own
  `xPercent` on top: an element slid with `xPercent` must not also carry a CSS
  translate (the chapter panel once stayed on screen). Let the `fromTo` set
  the start. And transforms do nothing on an inline `<span>`: make it
  `inline-block`.
- **`#stage video` outweighed every effect's own `#id` rule** (an id and a
  type beat an id alone): the halo, the echo's copies and the blurred layer
  all sat at z-index 1, under the cut-out — « Flouter toutes les personnes »
  hid nobody (2026-10-06). The base rule is `:where(#stage video)`. Check a
  layer with `getComputedStyle(el).zIndex` in the preview, not by reading CSS.
- **A tilt (3D transform) set by the timeline at 0 lands before a late
  font**: with a brand font, the setup scripts run after the first seek, and
  measured a tilted title. Static transforms that must not disturb a
  measurement go in the setup script, after it (the title's perspective).
- **Subtitles need macOS permission.** `Transcribe.app` is launched with
  `open -W -n -g` so the Speech Recognition prompt names it (a bare CLI would
  be attributed to whatever terminal started the studio). If the answer was
  "no", only the user can switch it back on in System Settings › Privacy &
  Security › Speech Recognition — never touch that yourself. Rebuilding the
  app changes its signature and may re-prompt.

- **Trimming rewrites the working file, not the model.** `POST …/trim` keeps
  the original as `media/<id>-orig<ext>` (`video.trim = { start, end, source,
  ext }`) and cuts a new `<id>-bg.mp4`; everything else keeps working in the
  clip's own time. Effects/lines pushed out by a cut remember their place
  (`fx.trimmedFrom`, `captions.offcuts`, `cue.full`) so widening restores them.
  The matte, people tracks and face are recomputed after a trim.

- **Montage par le texte = trim with holes.** `video.trim.cuts` are passages
  removed inside [start, end], in the original's time; `lib/textcut.mjs`
  maps times (`keptSegments`, `localOf`, `sourceOf`) and `shiftForTrim` takes
  `{ start, end, cuts }`. `cutClip({ segments })` joins them with one
  trim/concat filter (10 ms audio fades). The Whisper transcript lives in
  `media/<id>-transcript.json` (original's time, with a 10 ms loudness track
  that `settleCuts` uses to put cut edges in the quiet), deleted when the
  original is freed (`commitTrim`).
- **Whisper's own word times are wrong by up to a second** after a hesitation
  it does not write. Words are placed on the DTW token times
  (`-dtw large.v3.turbo`, which needs `-nfa`), checked against the Silero VAD
  (`whisper-vad-speech-segments`, centiseconds). Don't run `whisper-cli
  --vad`: its token times are then on the VAD-compressed timeline. Gaps with
  voice but no word are shown as « ≈ » hesitations, never cut by default (an
  acronym like "H&M" can look like one).

- **HDR clips render as the cut-out alone.** A phone video tagged BT.2020 /
  HLG (or PQ, or 10-bit) makes HyperFrames drop the background layer and
  every effect — even with `--sdr` — leaving only the cut-out on black
  (2026-10-05). Every working copy is therefore 8-bit BT.709 with a keyframe
  each second: `registerClip` flattens HDR imports (`media.isHdr`), clips
  imported before are converted once by `ensureSdr` before a preview or a
  render (`video.sdr`), and every encode (`flatten`, `cutClip`, `joinFilter`)
  sets the tags with `setparams` (`SDR_TAGS`) — x264 takes them from the
  frames, output options alone keep "HLG". HLG re-tagged as SDR looks right;
  PQ comes out flatter (no zscale in this ffmpeg to tone-map it).

- **`store.save()` chains writes but never lets one failure poison the
  chain** (a rejected link used to make every later save fail silently until
  restart). Keep the `.catch(() => {})` before `.then`.
- **Storage page deletes only what `classify()` marks deletable**, re-scanned
  server-side at each request (`POST /api/storage/delete` takes names, never
  paths). A new kind of file the studio writes must be recognised there, or it
  shows up as an orphan the user can delete.

## Decisions — do not revisit without being asked

- **No shot sequencing.** Chaining several shots into one video was built, then
  removed at the user's request (2026-09-25). One clip → one render.
  Promos (2026-09-28, asked for by the user) are not that: generated motion
  design scenes, not a chain of filmed clips.
- **Local first.** No accounts, no cloud; the server listens on 127.0.0.1 only.
  Subtitles use Whisper (whisper.cpp from Homebrew, models in `models/`,
  added 2026-10-03 at the user's request) and fall back to Apple's on-device
  recogniser when it is missing — never a speech API.
- **Zero runtime dependencies.** No `npm install`, no build step. Optional
  local AI tools sit outside node: whisper.cpp (Homebrew), PySceneDetect and
  SAM 2.1 + PyTorch in `.venv` (2026-10-03 / 05, asked for by the user); the studio checks for each and
  says how to install it when missing. Remotion
  stays in the separate `~/Code/promos` workspace.
- **Name: « Mon Studio Vidéo »** (renamed from « Mon Studio HyperFrame » on
  2026-09-29: folder `~/Code/mon-studio-video`, repo, launcher, UI). HyperFrames
  stays the name of the effects technology. The transcription app keeps its
  bundle id `local.mon-studio-hyperframe.transcribe`: macOS ties the speech
  permission to it.
- **Private GitHub repo**: `Lespa-R/mon-studio-video`. `studio.json`,
  `media/`, `renders/` are never committed.

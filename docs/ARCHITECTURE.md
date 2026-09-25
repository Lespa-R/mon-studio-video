# Mon Studio HyperFrame — architecture

Technical reference: how the studio is built, and why. For day-to-day use, see
the [README](../README.md); for working on the code with Claude, see
[CLAUDE.md](../CLAUDE.md).

A local video studio: keep a library of clips, stack effects on them, preview,
render with HyperFrames. Everything runs on your machine — no upload, no key.

```bash
npm run studio     # checks prerequisites, starts, opens the browser
npm start          # the server alone, http://localhost:3002
node bin/behind.mjs --video ~/Desktop/clip.mov --text "Hello World" --render
```

## The interface

Three columns:

- **Projets** — the folder/project tree, with `+ Projet` and `+ Dossier`.
  Click a project to switch to it; `✎` renames, `×` deletes.
- **Vidéos** — the clips of the active project. Drag & drop to add, `×` to
  remove (the clip and its derived files are deleted). Adding a clip probes it,
  bakes in any rotation, and locates the face across 24 samples.
- **Aperçu** — the live composition in an iframe, with play / restart, and a
  **timeline** below it. Every change re-renders it.
- **Effets** — add from the catalogue, tune the parameters, toggle with the
  checkbox, remove with `×`. Effects stack; order is the order you added them.

  **Rename any effect** by typing over its title — the name follows it into the
  timeline. Leave it empty to fall back to the catalogue label.

  **Copy effects from one clip to another.** *Copier les effets* copies the
  whole stack of the clip you are on; ⧉ on a card copies just that effect.
  Select another clip and *Coller* — if it already has effects, you choose
  between adding the copies after them or replacing them. The clipboard holds
  the effects themselves, not a link to their clip, so it survives the source
  being deleted and works across projects. Each pasted effect is rebuilt from
  its type's schema and gets an id of its own; a window longer than the target
  clip runs to its end.

  **★ saves the effect as a preset**: its type and its current parameters, under
  a name you choose. Presets appear under *Mes préréglages* in the add picker.
  They are per-studio, not per-project, so a look you like is one click away on
  any clip — and the **Bibliothèque d'effets** tab is where you build and sort
  them.

## Output format

The toolbar above the preview sets the project's output format — used by the
preview and by every render of the project's clips.

| Control | Options |
|---|---|
| **Format** | Source · 16:9 · 9:16 · 1:1 · 4:5 |
| **Taille** | Source · 720p · 1080p — the short side of the canvas |
| **Cadrage** | *Remplir* crops to fill the frame · *Adapter* shows the whole frame with bands |
| **Point focal** | (Remplir) *Sur le visage* keeps your face centred · *Au centre* |
| **Fond** | (Adapter) a blurred copy of the footage, black or white |

Each clip is composed on a **stage** at its own native size — the coordinates
face detection measured and every effect is positioned in — and the stage is
moved onto the canvas with a single transform. A 16:9 clip recropped to 9:16
sits at ×1.78, but the footage, the text behind you and your cut-out move as
one, so the occlusion stays exact. Effects know which part of the source is
visible (`view`), so text shrinks and slides to stay on screen.

Screen-anchored effects — lower third, vignette, grain, bands, fade — are drawn
on the canvas instead, so they frame the output rather than the source.

## The effect library

The second tab is a page of its own, for making looks rather than using them.

- **Collections** — group presets. *Tous* and *Sans collection* are always
  there; `+ Collection` adds your own, `✎` renames, `×` deletes (the presets
  inside survive and fall back to ungrouped).
- **Préréglages** — pick a base effect and `+ Nouveau préréglage` creates one
  from scratch, no clip needed, in the collection you are looking at. It is
  created at once under a free name, with the cursor in its name field so you
  can rename it straight away.
- **The editor** — the same schema-driven controls as the timeline's cards,
  plus rename, move to another collection, **Dupliquer** and **Supprimer**.

Above the editor is a **live preview**: the clip of your choice with this
preset as its *only* effect, so you tune a look without whatever else is on
that clip's timeline fighting it. Pick the clip from the dropdown; the matte is
built on demand and cached like anywhere else.

`lib/store.mjs` migrates a v2 file (presets with no collection) on first
load.

`Rendre le MP4` writes the file to `renders/` and hands you a download link.

## What happens when you change something

Every edit rewrites the composition and reloads the preview, and three things
make that feel immediate rather than like nothing happened:

- **Adding an effect jumps the preview to where that effect is on screen.** At
  frame 0 most effects have not animated in yet — their letters sit at
  `opacity: 0` — so a preview parked at 0 looks identical before and after.
  `showcaseTime()` picks a moment past the entrance but inside the effect's
  window, and the preview opens there.
- **Editing a parameter keeps the current time.** The studio passes it to the
  preview as `#t=`, so tuning an effect at 2.4s does not throw you back to the
  start on every keystroke.
- **Edits are coalesced.** Arrow keys on a number box fire one change each;
  they collapse into a single rebuild 220 ms after you stop.

The frame dims with a *mise à jour…* label while a rebuild is in flight, the
new effect's card scrolls into view and flashes, and the field you were editing
keeps focus and caret position across the redraw.

Shortcuts: **space** plays and pauses, **Home** returns to the start.

## The timeline

Each effect gets a bar under the preview. Drag it to move it, drag either edge
to trim it, and the bar prints its own in and out points. Clicking empty track
space — or the ruler — scrubs the preview, and a playhead follows playback.

Effects that cannot be placed show a grey **tout le clip** bar instead. Those
are the ones that drive CSS filters (`Étalonnage`, `Flou d'arrière-plan`): a
filter is a single shared property per layer, so two instances cannot animate
it independently. Everything else is placeable.

Placement lives on the instance (`start`, `duration` — `null` meaning "to the
end"), not in its params, so `lib/timing.mjs` resolves it the same way for
every effect.

### Entrances and exits

Text effects and the lower third now have an **Sortie (s)** control. The line
comes in letter by letter and leaves the same way but in reverse, unbuilding
from its end. Set it to `0` for a hard cut.

Every element is declared for the full clip in `data-start`/`data-duration`,
and GSAP alone decides when it is visible. Two reasons: the setup scripts
measure rendered text, which fails on an element the runtime has hidden; and a
`fromTo` renders immediately, so seeking before it leaves the target at its
"from" state — opacity 0 — for free.

## Effects

### Graphics

| Effect | What it does | Needs the cut-out |
|---|---|---|
| **Texte derrière moi** | The line passes behind you | yes |
| **Titre devant** | Same reveal, over the image. Positionable | no |
| **Bandeau (lower third)** | Name + role bottom-left, lateral entry | no |

`Hauteur (× visage)` on the behind-text effect runs from **-0.8 to 2**, measured
in face heights above the chin. Around `0.2` the line tucks under your chin;
around `1.1` it crosses your forehead; around `1.6` it rides across the top of
your head with the letters half hidden behind your hair. Every slider also has
a number box, which accepts values past the slider's own range.

The line is clamped to the canvas whatever the slider says. An extreme `rise`
with a large size would otherwise place it partly off-frame, and its exit
animation leaves by whichever side has more room, so the letters never slide
off on their way out.

### Animations (`lib/effects-anim.mjs`)

Titre surligné, Mots-clés percutants, Liste à puces, Compteur animé, Flèche
animée, Barre de progression, Bouton d'appel à l'action, Logo. All are
`space: "canvas"` — laid out on the output frame and sized on its short side —
so a 9:16 export gets a layout of its own rather than a scaled landscape one.

- **Counter**: the number is written by a series of `tl.set(el, { textContent })`
  calls, one per step (≤ 90), computed and formatted in French in Node. That is
  seekable both ways and needs neither a GSAP plugin nor callbacks firing on
  seek.
- **Arrow**: an SVG quadratic curve with `pathLength="1"`, drawn by tweening
  `stroke-dashoffset` from 1 to 0.
- **Call to action**: its pulse is a finite `yoyo` repeat sized to the window —
  an infinite repeat would make the root timeline infinite.
- Placement transforms and animated transforms live on different elements
  (a "spot" wrapper and the animated child): a GSAP tween on `x`/`y` would
  otherwise overwrite a `translate(-50%)` centring.

**Dragging on the preview.** The preview iframe is same-origin, so the UI reads
the boxes marked `data-drag="<fx id>"` straight from its document and lays a
handle over each (only while paused and inside the effect's window). During a
drag the element's root gets a CSS `translate` — it composes with the
transforms GSAP writes — and on drop the UI patches the params: `position:
"free"` with `x` / `y` as the box's new centre, or, for the arrow, `x` / `y`
shifted by the move. The composition then centres the box on (x %, y %) with
`translate(-50%, -50%)` on a wrapper that no tween touches.

Text effects take an **Animation** param (`TEXT_ANIMS` in `lib/effects.mjs`):
each style animates a unit — letters (`-ch`), words (`-wd`) or the whole line
(a `clip-path` wipe) — and `textTimeline()` compresses it to fit the window.

## Brand kits (`lib/brand.mjs`)

A brand kit is `{ colors: { primary, secondary, text, surface }, fonts: { title,
body }, logo }`, stored in `studio.json` (`brands`, v6) and chosen per project
(`project.brandId`, null = the studio default).

Effects never copy a kit's values. A colour param may hold a **token**,
`"brand:primary"`, which `paint()` compiles to `var(--brand-primary)`;
`compose()` declares the variables on `#root`, with `--font-title` and
`--font-body`. Changing the kit re-colours every linked effect on the next
preview or render, with no effect touched. A hex value stays fixed.

Fonts are either macOS system fonts (headless Chrome renders through CoreText,
so they match the preview) or files imported through `POST /api/assets`
(`font_<hex>.woff2|woff|ttf|otf`, checked by signature). An imported font gets
an `@font-face`, and the `init` scripts — which measure text — wait for
`document.fonts.load()`; the renderer itself waits for pending fonts before
the first frame. Every value is validated by `normaliseBrand()`, so nothing
from a kit reaches the page unchecked.

### Image treatments

| Effect | What it does | Needs the cut-out |
|---|---|---|
| **Étalonnage** | Exposure, contrast, saturation, colour temperature | no |
| **Flou d'arrière-plan** | Blurs the room, leaves you sharp | yes |
| **Remplacer l'arrière-plan** | Swaps the room for an uploaded image, a gradient or a colour | yes |
| **Vignettage** | Darkens the corners | no |
| **Grain argentique** | Film grain, with adjustable flicker rate | no |
| **Bandes cinéma** | Letterbox bars, 2.39 / 2.00 / 1.85 / 16:10 | no |
| **Fondu entrée / sortie** | Opens and closes on black | no |

Adding an effect that needs the cut-out triggers it automatically, once per
clip — it is cached and reused afterwards.

Image treatments compose rather than overwrite each other: an effect returns
`filters: { footage: [...], bg: [...] }` and `lib/compose.mjs` concatenates
them into a single CSS `filter` per layer. `footage` reaches both the
background and the cut-out person so they stay identical; `bg` reaches the
background alone — that asymmetry is exactly what makes the background blur
work.

The grain uses an `feTurbulence` texture with a fixed seed and a stepped GSAP
tween, so it flickers like real grain while staying byte-identical on every
render. No `Math.random` anywhere.

## How the "behind" effect works

```
1. the untouched footage
2. the type (+ a soft scrim)
3. you, cut out of those same frames   ← this is the trick
```

Layer 3 is the same footage with everything but the person erased, published as
a VP9 WebM with a real alpha channel. Whatever sits in layer 2 disappears
wherever you are. No green screen, no rotoscoping.

The cut-out needs a person, not a face: segmentation finds a silhouette seen
from behind or far away. Only the text's *placement* can use the face (anchor
"face": centred on it, `rise` face-heights above the chin). With anchor "free",
or when no face was detected, the line sits at `x` / `y` % of the source frame
— which is what dragging it on the preview writes. Stage effects carry
`data-anchor-x` / `data-anchor-y` (source pixels); the UI divides the move by
the stage's scale and adds it there.

The cut-out comes from Apple's **Vision** framework
(`VNGeneratePersonSegmentationRequest`), frame by frame, in Swift. Frames stream
as raw RGBA straight into ffmpeg — no intermediate files, constant memory
whatever the clip's length.

## Layout

```
bin/behind.mjs         one-shot CLI
server/server.mjs      HTTP + JSON API, zero dependencies
server/ui/index.html   the interface
lib/media.mjs          probe / face detection / person matte
lib/timing.mjs         where an effect instance sits on the clip
lib/format.mjs         output canvas, and how a clip is placed on it
lib/store.mjs          folders, projects (+ output format), presets — and safe persistence
lib/guard.mjs          who may talk to the studio (Host / Origin)
test/                  node --test, no dependencies
lib/effects.mjs        graphics catalogue — add new effects here
lib/effects-image.mjs  image treatments (filters, grain, vignette…)
lib/compose.mjs        clip + effects + format  →  HyperFrames composition
tools/facedet.swift    face box per frame          (Vision)
tools/personmatte.swift person cut out per frame   (Vision)
studio.json            your library and its effect stacks
media/                 clips and their derived mattes
```

`lib/` is shared by the CLI and the studio, so both produce byte-identical
compositions.

### Adding an effect

Append an object to `EFFECTS` in `lib/effects.mjs` with a `type`, a `label`, a
`schema` (which drives the UI controls on its own) and a `build(fx, video)`
returning `{ layer, needsMatte, css, html, init, timeline }`. Nothing else to
wire: the catalogue endpoint and the interface pick it up.

Set `timed: true` to give it a draggable bar, and call `timingOf(fx, video)`
inside `build` to get its `{ start, duration, end, full }`. `overlayTimeline()`
handles the in/out ramp for a full-frame overlay.

`layer` is `behind` (under the cut-out person), `front` or `top`. Set the
`z-index` in your CSS — `behind` 10-11, tint 55, `front` 60-62, vignette 80,
grain 82, letterbox 88, fade 90.

For a treatment rather than a graphic, return `filters` and/or `bgScale`
instead of markup; see `lib/effects-image.mjs`.

## Rendering

`Rendre le MP4` snapshots the clip and its effects **at the moment you click**,
composes that snapshot into a file of its own (`render-<job>.html`, removed
afterwards) and renders it with `--composition`. Keep editing while it runs:
nothing you change can reach a render already started.

Renders run **one at a time**. A second click queues behind the first and says
so; each one already starts several Chrome workers, and two in parallel only
thrash. `index.html` mirrors the last rendered composition, so `npm run check`
lints what you last exported.

The preview never touches the disk — it is composed in memory on every edit.
All it needs from the filesystem is the cut-out, which is built once per clip:
simultaneous requests for the same clip join the build already in flight, and
the encode writes to `*.partial.webm` before being renamed into place, so a
crash never leaves a half-written cut-out to be reused.

## Tests

```bash
npm test
```

No dependencies — `node --test`. The suite covers the pure parts: the
Host/Origin guard, the store (migrations, atomic saves, corrupt-file recovery),
timing, composition and every catalogue effect, and the parsing of ffprobe and
face-detection output. One test is marked `todo`: it documents a known gap
(text containing `</script>` can close the composition's script early) and
fails on purpose until it is fixed.

## Requirements

- macOS with the Command Line Tools (`swiftc`)
- Node 22+
- `ffmpeg` — `brew install ffmpeg`

The Swift helpers compile on first run.

## Port

The studio takes **3002** by default, the same port HyperFrames Studio
(`npm run dev`) uses. Whichever starts second walks up to the next free port and
says so. Force one with `PORT=3010 npm start`.

## Open the served page, not the file

`server/ui/index.html` only works when the studio serves it. Opened straight
off disk — an editor preview pane will sometimes do this for you after a save —
its relative API paths cannot resolve, and the browser reports
`Failed to parse URL from /api/videos`, which explains nothing. The page now
detects a `file://` origin and says so, with a link to
[http://localhost:3002](http://localhost:3002). Always work from that URL.

## Dialogs

Every question the studio asks — a name, a confirmation — goes through its own
in-page dialog, never `prompt()` or `confirm()`. Browsers embedded in apps
often refuse the native ones: the Claude desktop pane throws on `prompt()` and
answers every `confirm()` with `false`, which made creating presets impossible
and silently cancelled every deletion. Enter validates, Escape or a click
outside cancels. Any action that fails without its own handling shows up in a
toast at the bottom of the screen instead of failing silently.

## `npm run check` reports errors on purpose

Three findings always fire, and all three are false positives:

- **`text_occluded`** (Layout) — the linter sees the full-frame `#fg` video over
  the text and assumes it is opaque. It has no way to know the WebM carries an
  alpha channel. Text hidden by that layer *is* the feature.
- **`contrast`** — sampled against the footage, ignoring the scrim and ignoring
  that some letters are hidden behind you anyway.
- **`nested_structure_needs_subcomposition`** (Lint, warning) — the lower third
  nests markup inside a timed element. It only affects how HyperFrames Studio
  draws its timeline rows; the render is unaffected.

`Runtime` and `Motion` should stay clean — those are worth reading.

## Performance

On an M4 Pro, a 3 s 720p clip:

| Stage | Time |
|---|---|
| Probe + face detection (24 samples) | ~1 s |
| Segmentation + VP9/alpha encode | ~4 s |
| HyperFrames render | ~6 s |

Segmentation and VP9 encoding scale linearly with frame count, so a 3-minute
clip lands around 4–6 minutes for the cut-out (once, then cached) and ~5 minutes
per render. Drop the clip's `matteOptions.quality` in `studio.json` to
`balanced` for a faster first pass.

## Known limits

- **One person.** `VNGeneratePersonSegmentationRequest` returns a single
  combined mask; two people both land in the foreground layer.
- **Edge flicker.** The mask is computed per frame with no temporal model. Fast
  hand motion can shimmer at the edges. Raise `matteOptions.smooth` towards
  `0.3` in `studio.json` to calm it, at the cost of slight ghosting.
- **One composition file at a time.** `index.html` always holds the clip you are
  previewing. The library and every effect stack live in `studio.json`, so
  nothing is lost when you switch.
- **Alpha WebM is Chrome-only.** Fine here — HyperFrames renders in headless
  Chrome — but `media/*-fg.webm` looks opaque in QuickTime and in ffmpeg-based
  tools, which do not decode VP9 alpha.
- **Preview screenshots go black.** A browser quirk, not a bug: once a video has
  played, Chrome moves it to a hardware overlay and screen captures of it come
  out black. What you see live, and what gets rendered, are both correct.

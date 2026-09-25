#!/usr/bin/env node
// behind — one-shot CLI: put a line of text behind the person in a clip.
//
//   node bin/behind.mjs --video ~/Desktop/clip.mov --text "Hello World" --render
//
// Shares its whole pipeline with the studio (`npm start`): the analysis lives
// in lib/media.mjs, the effect in lib/effects.mjs, the composition in
// lib/compose.mjs. This file only wires them together for a single clip.

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import * as media from "../lib/media.mjs";
import { compose, needsMatte } from "../lib/compose.mjs";
import { defaultParams } from "../lib/effects.mjs";

const ROOT = media.ROOT;
const MEDIA = path.join(ROOT, "media");

const FLAGS = new Set(["render", "front"]);
const NUMBERS = new Set([
  "blur", "smooth", "samples", "scrim", "rise", "start", "reveal", "stagger", "fontScale",
]);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (FLAGS.has(key)) { opts[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined) die(`valeur manquante pour --${argv[i - 1].slice(2)}`);
    opts[key] = NUMBERS.has(key) ? Number(value) : value;
  }
  return opts;
}

const die = (m) => { console.error(`\nbehind: ${m}\n`); process.exit(1); };
const step = (m) => console.log(`  ${m}`);

const HELP = `
behind — place du texte derrière la personne d'une vidéo

  node bin/behind.mjs --video <fichier> [--text "Hello World"] [--render]

  --video <fichier>   clip source (requis)
  --text <texte>      la ligne à incruster              (défaut "Hello World")
  --front             passe le texte DEVANT (aucune découpe, bien plus rapide)
  --render            rend le MP4 dans la foulée
  --color <css>       couleur du texte                  (défaut #ffffff)
  --scrim <0..1>      opacité du voile, 0 pour aucun    (défaut 0.5)
  --font-scale <n>    taille du texte × hauteur cadre   (défaut 0.164)
  --rise <0..1>       hauteur au-dessus du menton,
                      en fraction de la hauteur du visage (défaut 0.18)
  --start <s>         début de la révélation            (défaut 0.2)
  --reveal <s>        durée de la révélation            (défaut 0.75)
  --stagger <s>       décalage entre lettres            (défaut 0.04)
  --quality <niveau>  segmentation: accurate|balanced|fast (défaut accurate)
  --blur <px>         adoucissement des bords du masque (défaut 1.5)
  --smooth <0..0.9>   lissage temporel, à monter si les bords scintillent
  --samples <n>       échantillons de détection du visage  (défaut 24)

Pour gérer plusieurs vidéos et empiler des effets : npm start
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.video) { console.log(HELP); process.exit(1); }

  for (const binary of ["ffmpeg", "ffprobe"]) {
    if (!media.have(binary)) die(`${binary} introuvable. Installe-le : brew install ffmpeg`);
  }
  media.buildTools();

  const source = path.resolve(String(opts.video).replace(/^~/, process.env.HOME || "~"));
  await fs.access(source).catch(() => die(`impossible de lire ${source}`));

  const id = path.basename(source, path.extname(source))
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip";
  const ext = path.extname(source).toLowerCase() || ".mp4";

  await fs.mkdir(MEDIA, { recursive: true });
  const bgFile = `${id}-bg${ext}`;
  const fgFile = `${id}-fg.webm`;
  const bgPath = path.join(MEDIA, bgFile);
  await fs.copyFile(source, bgPath);

  console.log(`\nbehind · ${path.basename(source)} · "${opts.text || "Hello World"}"\n`);

  let info = media.probe(bgPath);
  if (info.rotation) {
    step(`rotation de ${info.rotation}° appliquée aux pixels`);
    media.flatten(bgPath, info.rotation);
    info = media.probe(bgPath);
  }
  step(`${info.width}x${info.height} · ${info.fps.toFixed(2)} fps · ` +
       `${info.duration.toFixed(2)}s · audio ${info.hasAudio ? "oui" : "non"}`);

  const face = media.detectFace(bgPath, opts.samples || 24);
  if (!face) die("aucun visage détecté — utilise le studio (npm start) pour placer le texte à la main");
  step(`visage centre x=${face.centreX} · menton y=${face.chinMin}-${face.chinMax} · ` +
       `détecté sur ${Math.round(face.coverage * 100)}% des échantillons`);

  const type = opts.front ? "title" : "behind-text";
  const params = { ...defaultParams(type) };
  for (const key of ["text", "color", "scrim", "rise", "start", "reveal", "stagger", "fontScale"]) {
    if (opts[key] !== undefined) params[key] = opts[key];
  }

  const video = {
    id, name: path.basename(source), ext,
    width: info.width, height: info.height,
    fps: info.fps, fpsExact: info.fpsExact,
    duration: info.duration, hasAudio: info.hasAudio,
    face,
    effects: [{ id: "fx_main", type, enabled: true, params }],
  };

  if (needsMatte(video)) {
    step("découpe de la personne sur chaque image…");
    const started = Date.now();
    const result = await media.makeMatte(
      bgPath, info, path.join(MEDIA, fgFile),
      { quality: opts.quality || "accurate", blur: opts.blur ?? 1.5, smooth: opts.smooth ?? 0 });
    step(`découpe terminée en ${((Date.now() - started) / 1000).toFixed(1)}s` +
         (result.missing ? ` · ${result.missing} images sans personne` : ""));
  }

  await fs.writeFile(path.join(ROOT, "index.html"), compose(video, { bgFile, fgFile }));
  step("composition écrite dans index.html");

  if (opts.render) {
    console.log("");
    spawnSync("npm", ["run", "--silent", "render"], { cwd: ROOT, stdio: "inherit" });
  } else {
    console.log(`\n  ensuite :  npm run render   # rendre le MP4`);
    console.log(`             npm start        # ouvrir le studio\n`);
  }
}

main().catch((error) => die(error.stack || error.message));

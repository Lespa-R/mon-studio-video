// « Promos » : vidéos motion design de sites, rendues avec Remotion.
//
// The studio does not embed Remotion (zero dependencies): promos live in their
// own workspace (PROMOS_DIR, default ~/Code/promos, one shared npm install) and
// the skill `promo-site` (PROMO_SKILL_DIR, default ~/.claude/skills/promo-site)
// provides the engine template and the scripts. Here we list promos, edit their
// storyboard.json, hand them a studio brand kit, and run the skill's scripts as
// studio jobs — renders share the studio's one-at-a-time queue.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  SCENE_TYPES, ENERGIES, MOODS, PROMO_FORMATS, SLUG, slugify,
  normaliseStoryboard, starterStoryboard, promoTiming, storyboardWarnings, promoBrand,
} from "../lib/promos.mjs";

export const PROMOS_DIR = process.env.PROMOS_DIR || path.join(os.homedir(), "Code", "promos");
export const SKILL_DIR = process.env.PROMO_SKILL_DIR || path.join(os.homedir(), ".claude", "skills", "promo-site");
const script = (name) => path.join(SKILL_DIR, "scripts", name);
const ENV = { ...process.env, PROMOS_DIR, PROMO_LOG: "info", PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };

// Files of a promo the UI may load. Anything else stays private.
const SERVABLE = /^(out\/check\/sheet\.png|out\/[\w.-]+\.mp4|site\/shot\.png|public\/site\.png|public\/brand\/logo\.png)$/;

const exists = (p) => fsp.access(p).then(() => true, () => false);

// Deleting a promo or a render never destroys anything: it goes to the macOS
// Trash, where Robin can put it back. rename() is instant on the same volume;
// a copy + remove covers the rest.
async function toTrash(target, label) {
  const trash = path.join(os.homedir(), ".Trash");
  const ext = path.extname(target);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  let dest = path.join(trash, `${label || path.basename(target, ext)} (promo ${stamp})${ext}`);
  for (let i = 2; await exists(dest); i++) dest = dest.replace(/( \d+)?(\.\w+)?$/, ` ${i}$2`);
  try {
    await fsp.rename(target, dest);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await fsp.cp(target, dest, { recursive: true });
    await fsp.rm(target, { recursive: true, force: true });
  }
  return dest;
}

function run(cmd, args, { cwd, job, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: ENV });
    let log = "";
    const watch = (chunk) => {
      const text = String(chunk);
      log += text;
      for (const line of text.split(/\r|\n/)) if (line.trim()) onLine?.(line.trim(), job);
    };
    proc.stdout.on("data", watch);
    proc.stderr.on("data", watch);
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(`${path.basename(cmd)} a échoué (${code})\n${log.slice(-1500)}`))));
  });
}

// Remotion prints "Rendered 120/1050" (and similar) while rendering.
const remotionProgress = (line, job) => {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(line);
  if (m && Number(m[2]) > 10) job.progress = Math.min(0.99, Number(m[1]) / Number(m[2]));
};

export function makePromos({ store, startJob, inRenderQueue, send, readJson, serveFile, MEDIA, importClip, fontLabels }) {
  const dirOf = (slug) => path.join(PROMOS_DIR, slug);

  async function status() {
    return {
      workspace: PROMOS_DIR,
      skill: SKILL_DIR,
      hasSkill: await exists(script("new_promo.sh")),
      hasWorkspace: await exists(path.join(PROMOS_DIR, "node_modules", "remotion")),
    };
  }

  async function readStoryboard(slug) {
    const raw = JSON.parse(await fsp.readFile(path.join(dirOf(slug), "storyboard.json"), "utf8"));
    return normaliseStoryboard(raw);
  }

  async function readBrand(slug) {
    try { return JSON.parse(await fsp.readFile(path.join(dirOf(slug), "public", "brand", "brand.json"), "utf8")); } catch { return null; }
  }

  async function renders(slug) {
    const out = path.join(dirOf(slug), "out");
    let names = [];
    try { names = await fsp.readdir(out); } catch { return []; }
    const list = [];
    for (const name of names.filter((n) => n.endsWith(".mp4") && !n.startsWith("."))) {
      const st = await fsp.stat(path.join(out, name));
      list.push({ name, size: st.size, mtime: st.mtimeMs, url: `/promos/${slug}/out/${name}` });
    }
    return list.sort((a, b) => b.mtime - a.mtime);
  }

  const mtimeOf = async (p) => { try { return (await fsp.stat(p)).mtimeMs; } catch { return null; } };

  async function summary(slug) {
    const sb = await readStoryboard(slug);
    const brand = await readBrand(slug);
    const t = promoTiming(sb);
    const r = await renders(slug);
    return {
      slug, title: sb.title || slug, url: sb.url, formats: sb.formats, scenes: sb.scenes.length,
      duration: t.total, brand: brand ? { name: brand.name, studioBrandId: brand.studioBrandId || null } : null,
      lastRender: r[0] || null,
    };
  }

  async function detail(slug) {
    const dir = dirOf(slug);
    const sb = await readStoryboard(slug);
    const sheet = await mtimeOf(path.join(dir, "out", "check", "sheet.png"));
    const shot = await mtimeOf(path.join(dir, "site", "shot.png"));
    return {
      slug, folder: dir, storyboard: sb, brand: await readBrand(slug),
      timing: promoTiming(sb), warnings: storyboardWarnings(sb), renders: await renders(slug),
      music: await mtimeOf(path.join(dir, "public", "music.wav")),
      sheet: sheet ? `/promos/${slug}/out/check/sheet.png?t=${Math.round(sheet)}` : null,
      shot: shot ? `/promos/${slug}/site/shot.png?t=${Math.round(shot)}` : null,
      check: await fsp.readFile(path.join(dir, "out", "check", "report.txt"), "utf8").catch(() => null),
    };
  }

  async function list() {
    let names = [];
    try { names = await fsp.readdir(PROMOS_DIR); } catch { /* no workspace yet */ }
    const promos = [];
    for (const name of names) {
      if (!SLUG.test(name) || name === "node_modules") continue;
      if (!(await exists(path.join(dirOf(name), "storyboard.json")))) continue;
      try { promos.push(await summary(name)); } catch (e) { promos.push({ slug: name, title: name, error: e.message }); }
    }
    return promos;
  }

  async function writeStoryboard(slug, raw) {
    const sb = normaliseStoryboard(raw);
    const file = path.join(dirOf(slug), "storyboard.json");
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(sb, null, 1));
    await fsp.rename(`${file}.tmp`, file);
    return sb;
  }

  async function exportBrand(slug, brandId) {
    const brand = store.state.brands.find((b) => b.id === brandId);
    if (!brand) throw new Error("charte introuvable");
    const outDir = path.join(dirOf(slug), "public", "brand");
    await fsp.mkdir(outDir, { recursive: true });
    let logo = null;
    if (brand.logo) {
      const log = await run("python3", [script("prepare_logo.py"), path.join(MEDIA, brand.logo), path.join(outDir, "logo.png")]);
      logo = JSON.parse(log.trim().split("\n").pop());
    }
    const { json, copies } = promoBrand(brand, { fonts: store.state.fonts || [], labels: fontLabels, logo });
    for (const c of copies) await fsp.copyFile(path.join(MEDIA, c.from), path.join(outDir, c.to));
    // A single-weight display font (Bebas Neue…) set by hand stays set, and the
    // site's theme (light/dark, title gradient, CTA — from site_theme.py) is the
    // promo's own: changing kits does not wipe it.
    const prev = await readBrand(slug);
    if (prev?.fonts?.title?.weight && prev.fonts.title.family === json.fonts.title.family) json.fonts.title.weight = prev.fonts.title.weight;
    if (prev?.theme) json.theme = prev.theme;
    await fsp.writeFile(path.join(outDir, "brand.json"), JSON.stringify(json, null, 1));
    return json;
  }

  async function create({ title, url }) {
    const slug = slugify(title);
    if (await exists(dirOf(slug))) throw new Error(`Une promo « ${slug} » existe déjà.`);
    if (!(await exists(script("new_promo.sh")))) throw new Error(`Skill promo-site introuvable (${SKILL_DIR}).`);
    return startJob("promo-new", async (job) => {
      job.message = (await exists(path.join(PROMOS_DIR, "node_modules", "remotion")))
        ? "Création de la promo…"
        : "Première promo : installation de Remotion (une seule fois, ~1 min)…";
      await run("bash", [script("new_promo.sh"), slug], { job });
      await writeStoryboard(slug, starterStoryboard(title, url));
      // Only a kit of the same name is taken for granted; otherwise a neutral
      // one, and Robin (or the skill) picks the right kit.
      const norm = (x) => slugify(x);
      const brandId = store.state.brands.find((b) => norm(b.name) === slug)?.id;
      if (brandId) await exportBrand(slug, brandId);
      else await fsp.writeFile(path.join(dirOf(slug), "public", "brand", "brand.json"), JSON.stringify({
        name: title, colors: { primary: "#4f8cff", secondary: "#f088b4", text: "#f7f9fb", surface: "#0b172c" },
        fonts: { title: { family: "Georgia" }, body: { family: "SF Pro Display" } },
      }, null, 1));
      return { slug };
    });
  }

  async function handleApi(req, res, parts) {
    const [, , slug, sub, subId] = parts;

    if (!slug) {
      if (req.method === "GET") {
        return send(res, 200, {
          ...(await status()), promos: await list(),
          catalogue: { scenes: SCENE_TYPES, energies: ENERGIES, moods: MOODS, formats: PROMO_FORMATS },
        });
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!String(body.title || "").trim()) return send(res, 400, { error: "Donne un nom à la promo." });
        return send(res, 200, { job: await create(body) });
      }
    }

    if (!SLUG.test(slug) || !(await exists(path.join(dirOf(slug), "storyboard.json")))) {
      return send(res, 404, { error: "promo introuvable" });
    }
    const dir = dirOf(slug);

    if (!sub && req.method === "GET") return send(res, 200, await detail(slug));

    if (sub === "storyboard" && req.method === "PUT") {
      await writeStoryboard(slug, await readJson(req));
      return send(res, 200, await detail(slug));
    }

    if (sub === "brand" && req.method === "POST") {
      const { brandId } = await readJson(req);
      await exportBrand(slug, brandId);
      return send(res, 200, await detail(slug));
    }

    if (sub === "capture" && req.method === "POST") {
      const sb = await readStoryboard(slug);
      if (!sb.url) return send(res, 400, { error: "Renseigne l'adresse du site d'abord." });
      return send(res, 200, { job: startJob("promo-capture", async (job) => {
        job.message = "Capture du site (page entière)…";
        await run("bash", [script("capture_site.sh"), sb.url, path.join(dir, "site")], { job });
        job.message = "Analyse des textes, couleurs et polices…";
        await run("python3", [script("parse_site.py"), path.join(dir, "site"), sb.url], { job });
        await fsp.copyFile(path.join(dir, "site", "shot.png"), path.join(dir, "public", "site.png"));
        job.message = "Thème de la vidéo d'après le site (clair/sombre, dégradés, boutons)…";
        const theme = await run("python3", [script("site_theme.py"), dir], { job });
        return { theme: theme.trim().split("\n").pop() };
      }) });
    }

    if (sub === "music" && req.method === "POST") {
      return send(res, 200, { job: startJob("promo-music", async (job) => {
        const sb = await readStoryboard(slug);
        if (sb.music.mode === "file") return { skipped: "musique fournie (fichier)" };
        job.message = `Composition de la musique (${sb.music.mood}, ${sb.music.bpm} BPM)…`;
        const log = await run("python3", [path.join(dir, "music", "compose.py"), dir], { job });
        return { log: log.trim().split("\n").pop() };
      }) });
    }

    if (sub === "check" && req.method === "POST") {
      return send(res, 200, { job: startJob("promo-check", async (job) => {
        if (!(await exists(path.join(dir, "public", "music.wav"))) && (await readStoryboard(slug)).music.mode !== "file") {
          job.message = "Composition de la musique…";
          await run("python3", [path.join(dir, "music", "compose.py"), dir], { job });
        }
        job.message = "Brouillon à mi-résolution et planche de contrôle…";
        const log = await run("bash", [script("check_render.sh"), dir], { job, onLine: remotionProgress });
        const report = log.split("\n").filter((l) => /Bords|Niveau/.test(l)).map((l) => l.replace(/^⚠️ /, "")).join("\n");
        await fsp.writeFile(path.join(dir, "out", "check", "report.txt"), report);
        return { report };
      }) });
    }

    if (sub === "render" && req.method === "POST") {
      return send(res, 200, { job: startJob("promo-render", (job) => inRenderQueue(job, async () => {
        const sb = await readStoryboard(slug);
        if (!(await exists(path.join(dir, "public", "music.wav"))) && sb.music.mode !== "file") {
          job.message = "Composition de la musique…";
          await run("python3", [path.join(dir, "music", "compose.py"), dir], { job });
        }
        job.message = `Rendu Remotion (${sb.formats.join(", ")}) puis finition LinkedIn…`;
        job.progress = 0;
        await run("bash", [script("render.sh"), dir], { job, onLine: remotionProgress });
        return { renders: await renders(slug) };
      })) });
    }

    if (sub === "clip" && req.method === "POST") {
      const { name } = await readJson(req);
      if (!/^[\w.-]+\.mp4$/.test(String(name))) return send(res, 400, { error: "fichier invalide" });
      const file = path.join(dir, "out", name);
      if (!(await exists(file))) return send(res, 404, { error: "rendu introuvable" });
      return send(res, 200, await importClip(file, name));
    }

    // Whole promo → Trash (storyboard, captures, music, renders).
    if (!sub && req.method === "DELETE") {
      const moved = await toTrash(dir, slug);
      return send(res, 200, { ok: true, trash: moved });
    }

    // One rendered video → Trash.
    if (sub === "renders" && req.method === "DELETE") {
      const name = decodeURIComponent(subId || "");
      if (!/^[\w.-]+\.mp4$/.test(name)) return send(res, 400, { error: "fichier invalide" });
      const file = path.join(dir, "out", name);
      if (!(await exists(file))) return send(res, 404, { error: "rendu introuvable" });
      await toTrash(file);
      return send(res, 200, await detail(slug));
    }

    if (sub === "reveal" && req.method === "POST") {
      const { name } = await readJson(req);
      const target = name && /^[\w.-]+\.mp4$/.test(name) ? path.join(dir, "out", name) : dir;
      spawn("open", ["-R", target], { stdio: "ignore" });
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "not found" });
  }

  async function serve(req, res, p) {
    // /promos/<slug>/<rest>
    const [, , slug, ...rest] = p.split("/");
    const rel = rest.join("/");
    if (!SLUG.test(slug || "") || !SERVABLE.test(rel)) return send(res, 404, { error: "not found" });
    return serveFile(req, res, path.join(dirOf(slug), rel));
  }

  return { handleApi, serve, exists: () => fs.existsSync(PROMOS_DIR) };
}

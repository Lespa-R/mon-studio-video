// « Promos » : vidéos motion design de sites, rendues avec Remotion.
//
// The studio does not embed Remotion (zero dependencies): promos live in their
// own workspace (PROMOS_DIR, default ~/Code/promos, one shared npm install) and
// the skill `promo-site` (PROMO_SKILL_DIR, default ~/.claude/skills/promo-site)
// provides the engine template and the scripts. Here we list promos, edit their
// storyboard.json, hand them a studio brand kit, and run the skill's scripts as
// studio jobs — renders share the studio's one-at-a-time queue.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  SCENE_TYPES, ENERGIES, MOODS, PROMO_FORMATS, SLUG, slugify,
  normaliseStoryboard, starterStoryboard, promoTiming, storyboardWarnings, promoBrand,
} from "../lib/promos.mjs";

export const PROMOS_DIR = process.env.PROMOS_DIR || path.join(os.homedir(), "Code", "promos");
export const SKILL_DIR = process.env.PROMO_SKILL_DIR || path.join(os.homedir(), ".claude", "skills", "promo-site");
// Keeps Remotion Studio on 127.0.0.1 (it binds every interface otherwise).
const LOOPBACK = fileURLToPath(new URL("./loopback.cjs", import.meta.url));
const script = (name) => path.join(SKILL_DIR, "scripts", name);
const ENV = { ...process.env, PROMOS_DIR, PROMO_LOG: "info", PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };

// Files of a promo the UI may load. Anything else stays private.
const SERVABLE = /^(out\/check\/sheet(-scene)?\.png|out\/check\/scene-\d+\.mp4|out\/[\w.-]+\.mp4|out\/[\w.-]+-cover\.jpg|site\/shot\.png|public\/site\.png|public\/brand\/logo\.png)$/;
// Pictures a scene may point at (copied along when a scene is imported).
const ASSET_REF = /^[\w./-]+\.(png|jpe?g|webp|svg|gif)$/i;

// The engine files a promo gets from the skill's template. A promo keeps its
// own copy (a fix for one video stays in that video); the studio says when
// the template has moved on and can bring a promo up to date.
async function engineFiles(src) {
  const out = [];
  const walk = async (dir, rel) => {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (r === "engine" || r.startsWith("engine/")) await walk(path.join(dir, e.name), r); }
      else if (r.startsWith("engine/") || ["Promo.tsx", "Root.tsx", "index.ts"].includes(r)) out.push(r);
    }
  };
  await walk(src, "");
  return out.sort();
}

async function engineStamp(src) {
  const files = await engineFiles(src);
  const hash = crypto.createHash("sha1");
  let mtime = 0;
  for (const f of files) {
    const full = path.join(src, f);
    hash.update(f).update(await fsp.readFile(full));
    mtime = Math.max(mtime, (await fsp.stat(full)).mtimeMs);
  }
  return { hash: hash.digest("hex"), mtime, files: files.length };
}

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
      const cover = name.replace(/\.mp4$/, "-cover.jpg");
      const hasCover = await exists(path.join(out, cover));
      list.push({ name, size: st.size, mtime: st.mtimeMs, url: `/promos/${slug}/out/${name}`, cover: hasCover ? `/promos/${slug}/out/${cover}?t=${Math.round(st.mtimeMs)}` : null });
    }
    return list.sort((a, b) => b.mtime - a.mtime);
  }

  const mtimeOf = async (p) => { try { return (await fsp.stat(p)).mtimeMs; } catch { return null; } };

  async function engineStatus(slug) {
    const [mine, latest] = await Promise.all([engineStamp(path.join(dirOf(slug), "src")), engineStamp(path.join(SKILL_DIR, "template", "src"))]);
    if (!latest.files) return null;
    const same = mine.hash === latest.hash;
    return { same, newer: !same && latest.mtime > mine.mtime };
  }

  // Remotion Studio (interactive preview, frame by frame), one per promo.
  const previews = new Map(); // slug → { proc, url }
  // npx starts Remotion as a child: kill the whole process group.
  const stopPreviews = () => { for (const p of previews.values()) try { process.kill(-p.proc.pid); } catch { /* gone */ } };
  process.once("exit", stopPreviews);
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { stopPreviews(); process.exit(0); });

  const freePort = (from) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(freePort(from + 1)));
    srv.listen(from, "127.0.0.1", () => srv.close(() => resolve(from)));
  });

  async function openPreview(slug) {
    const running = previews.get(slug);
    if (running) {
      spawn("open", [running.url], { stdio: "ignore" });
      return running.url;
    }
    const port = await freePort(3400);
    const url = `http://localhost:${port}`;
    const proc = spawn("npx", ["remotion", "studio", path.join(slug, "src", "index.ts"), `--public-dir=${path.join(slug, "public")}`, `--port=${port}`],
      { cwd: PROMOS_DIR, env: { ...ENV, NODE_OPTIONS: `--require ${LOOPBACK}` }, stdio: "ignore", detached: true });
    previews.set(slug, { proc, url });
    proc.on("exit", () => { if (previews.get(slug)?.proc === proc) previews.delete(slug); });
    return url;
  }

  // Refresh the publication files (post text, cover, fiche) after an edit.
  const repackage = (dir) => exists(path.join(dir, "out", "publish.json")).then((has) =>
    has && run("python3", [script("package.py"), dir]).catch((e) => console.error("package.py :", e.message)));

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
      publish: await fsp.readFile(path.join(dir, "out", "publish.json"), "utf8").then(JSON.parse, () => null),
      engine: await engineStatus(slug),
      preview: previews.get(slug)?.url || null,
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
      repackage(dir);
      return send(res, 200, await detail(slug));
    }

    // Draft of the LinkedIn post, from the storyboard (when none was written).
    if (sub === "post-draft" && req.method === "GET") {
      const text = await run("python3", [script("package.py"), dir, "--post"]);
      return send(res, 200, { text });
    }

    // Only one scene, at half resolution: a few seconds instead of the whole video.
    if (sub === "scene" && req.method === "POST") {
      const { index } = await readJson(req);
      const sb = await readStoryboard(slug);
      const n = Number(index);
      if (!Number.isInteger(n) || n < 0 || n >= sb.scenes.length) return send(res, 400, { error: "scène inconnue" });
      return send(res, 200, { job: startJob("promo-scene", async (job) => {
        if (!(await exists(path.join(dir, "public", "music.wav"))) && sb.music.mode !== "file") {
          job.message = "Composition de la musique…";
          await run("python3", [path.join(dir, "music", "compose.py"), dir], { job });
        }
        job.message = `Aperçu de la scène ${n + 1}…`;
        const log = await run("bash", [script("check_render.sh"), dir, sb.formats[0], "--scene", String(n + 1)], { job, onLine: remotionProgress });
        const stamp = Date.now();
        return {
          index: n,
          video: `/promos/${slug}/out/check/scene-${n + 1}.mp4?t=${stamp}`,
          sheet: `/promos/${slug}/out/check/sheet-scene.png?t=${stamp}`,
          report: log.split("\n").filter((l) => /Textes|^\s+·|Bords/.test(l)).map((l) => l.replace(/^⚠️ /, "")).join("\n"),
        };
      }) });
    }

    if (sub === "preview" && req.method === "POST") {
      const url = await openPreview(slug);
      return send(res, 200, { url });
    }

    // Bring the promo's engine up to the skill's template; the old copy goes to the Trash.
    if (sub === "engine" && req.method === "POST") {
      const src = path.join(dir, "src");
      const tpl = path.join(SKILL_DIR, "template", "src");
      if (!(await exists(tpl))) return send(res, 400, { error: "modèle de la skill introuvable" });
      await toTrash(src, `${slug} moteur`);
      await fsp.cp(tpl, src, { recursive: true });
      return send(res, 200, await detail(slug));
    }

    // Copy a scene from another promo, with the pictures it points at.
    if (sub === "import-scene" && req.method === "POST") {
      const { from, index } = await readJson(req);
      if (!SLUG.test(String(from)) || !(await exists(path.join(dirOf(from), "storyboard.json")))) return send(res, 404, { error: "promo source introuvable" });
      const scene = (await readStoryboard(from)).scenes[Number(index)];
      if (!scene) return send(res, 404, { error: "scène introuvable" });
      const refs = new Set();
      const collect = (v) => {
        if (typeof v === "string" && ASSET_REF.test(v) && !v.includes("..")) refs.add(v);
        else if (v && typeof v === "object") Object.values(v).forEach(collect);
      };
      collect(scene.props);
      const copied = [];
      for (const ref of refs) {
        const srcFile = path.join(dirOf(from), "public", ref);
        const dest = path.join(dir, "public", ref);
        if (!(await exists(srcFile)) || (await exists(dest))) continue;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(srcFile, dest);
        copied.push(ref);
      }
      return send(res, 200, { scene, copied });
    }

    // The soundtrack alone (for another edit), next to the renders.
    if (sub === "music-export" && req.method === "POST") {
      const sb = await readStoryboard(slug);
      const src = sb.music.mode === "file" ? path.join(dir, "public", sb.music.file) : path.join(dir, "public", "music.wav");
      if (!(await exists(src))) return send(res, 400, { error: "pas encore de musique : lance « Nouvelle musique »" });
      const out = path.join(dir, "out", `${slug}-musique.m4a`);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-c:a", "aac", "-b:a", "256k", out]);
      spawn("open", ["-R", out], { stdio: "ignore" });
      return send(res, 200, { file: out });
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
        // The skill's composer is the reference: a promo made earlier gets its updates.
        await fsp.copyFile(path.join(SKILL_DIR, "template", "music", "compose.py"), path.join(dir, "music", "compose.py")).catch(() => {});
        job.message = `Nouvelle musique (${sb.music.mood}, ${sb.music.bpm} BPM)…`;
        // Each click draws a new variation (new seed, never another promo's).
        const log = await run("python3", [path.join(dir, "music", "compose.py"), dir, "--new"], { job });
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

  // Disk used by promos (outside the studio folder), for the Storage page.
  async function usage() {
    let names = [];
    try { names = await fsp.readdir(PROMOS_DIR); } catch { return null; }
    const size = async (p) => {
      const st = await fsp.lstat(p).catch(() => null);
      if (!st) return 0;
      if (!st.isDirectory()) return st.size;
      let n = 0;
      for (const e of await fsp.readdir(p)) n += await size(path.join(p, e));
      return n;
    };
    const items = [];
    let engine = 0;
    for (const name of names) {
      if (name === "node_modules") { engine = await size(path.join(PROMOS_DIR, name)); continue; }
      if (!SLUG.test(name) || !(await exists(path.join(dirOf(name), "storyboard.json")))) continue;
      items.push({ slug: name, size: await size(dirOf(name)) });
    }
    items.sort((a, b) => b.size - a.size);
    return { folder: PROMOS_DIR, engine, items, total: engine + items.reduce((s, x) => s + x.size, 0) };
  }

  return { handleApi, serve, usage, exists: () => fs.existsSync(PROMOS_DIR) };
}

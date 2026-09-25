// A small local studio: manage a library of clips and stack effects on them.
// Zero dependencies — plain node:http, so `npm start` works with no install.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { catalogue, defaultParams, byType, isTimed } from "../lib/effects.mjs";
import { Store, newId } from "../lib/store.mjs";
import { compose, needsMatte } from "../lib/compose.mjs";
import * as media from "../lib/media.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = path.join(ROOT, "media");
const RENDERS = path.join(ROOT, "renders");
const UI = path.join(ROOT, "server", "ui");
const STATE_FILE = path.join(ROOT, "studio.json");

const HYPERFRAMES = "hyperframes@0.8.75";

// ------------------------------------------------------------------- state

const store = new Store(STATE_FILE);
const saveState = () => store.save();
const findVideo = (id) => store.video(id);

// -------------------------------------------------------------------- jobs

const jobs = new Map();

function startJob(label, worker) {
  const id = newId("job_");
  const job = { id, label, status: "running", progress: 0, message: "", error: null };
  jobs.set(id, job);
  Promise.resolve()
    .then(() => worker(job))
    .then((result) => {
      job.status = "done";
      job.progress = 1;
      job.result = result ?? null;
    })
    .catch((error) => {
      job.status = "error";
      job.error = String(error.message || error);
      console.error(`[${label}]`, error);
    });
  return job;
}

// --------------------------------------------------------------- pipeline

function mediaNames(video) {
  return { bg: `${video.id}-bg${video.ext}`, fg: `${video.id}-fg.webm` };
}

async function ensureMatte(video, job) {
  const { bg, fg } = mediaNames(video);
  const target = path.join(MEDIA, fg);
  try {
    await fsp.access(target);
    if (video.matteSignature === matteSignature(video)) return fg;
  } catch { /* needs building */ }

  job.message = "Découpe de la personne image par image…";
  const info = {
    width: video.width, height: video.height,
    fps: video.fps, fpsExact: video.fpsExact, duration: video.duration,
  };
  const result = await media.makeMatte(
    path.join(MEDIA, bg), info, target, video.matteOptions || {},
    (p) => { job.progress = p; });

  video.matteSignature = matteSignature(video);
  video.matteMissing = result.missing;
  await saveState();
  return fg;
}

const matteSignature = (video) =>
  JSON.stringify(video.matteOptions || {}) + "|" + video.ext;

async function writeComposition(video) {
  const { bg, fg } = mediaNames(video);
  const html = compose(video, { bgFile: bg, fgFile: fg });
  await fsp.writeFile(path.join(ROOT, "index.html"), html);
  store.state.activeVideo = video.id;
  await saveState();
  return html;
}

function renderJob(video) {
  return startJob("render", async (job) => {
    if (needsMatte(video)) await ensureMatte(video, job);
    await writeComposition(video);

    job.message = "Rendu HyperFrames…";
    job.progress = 0;

    const output = path.join("renders", `${slug(video.name)}-${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      const proc = spawn("npx", ["--yes", HYPERFRAMES, "render", "--output", output], {
        cwd: ROOT,
        env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
      });
      let log = "";
      const watch = (chunk) => {
        const text = String(chunk);
        log += text;
        const m = /(\d+)%/g;
        let last;
        let hit;
        while ((hit = m.exec(text))) last = Number(hit[1]);
        if (last !== undefined) job.progress = last / 100;
      };
      proc.stdout.on("data", watch);
      proc.stderr.on("data", watch);
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`render exited ${code}\n${log.slice(-2000)}`)));
    });

    return { output: `/${output}` };
  });
}

const slug = (name) =>
  path.basename(name, path.extname(name)).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip";

// ------------------------------------------------------------------ helpers

const send = (res, code, body, type = "application/json") => {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, {
    "content-type": type + (type.startsWith("text/") || type.endsWith("json") ? "; charset=utf-8" : ""),
    "cache-control": "no-store",
  });
  res.end(payload);
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".webm": "video/webm", ".m4v": "video/mp4", ".svg": "image/svg+xml",
};

// Serve a file with Range support — the browser needs it to scrub video.
async function serveFile(req, res, file) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, { error: "not found" }); }

  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : stat.size - 1;
    res.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    "content-type": type,
    "content-length": stat.size,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

// ------------------------------------------------------------------- routes

async function addVideo(req, res) {
  const original = decodeURIComponent(req.headers["x-filename"] || "clip.mov");
  const ext = path.extname(original).toLowerCase() || ".mp4";
  const id = newId("vid_");
  const target = path.join(MEDIA, `${id}-bg${ext}`);

  await fsp.mkdir(MEDIA, { recursive: true });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target);
    req.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    req.on("error", reject);
  });

  let info;
  try {
    info = media.probe(target);
  } catch (error) {
    await fsp.rm(target, { force: true });
    return send(res, 400, { error: `Fichier illisible : ${error.message}` });
  }

  if (info.rotation) {
    media.flatten(target, info.rotation);
    info = media.probe(target);
  }

  let face = null;
  try { face = media.detectFace(target, 24); } catch { /* optional */ }

  const video = {
    id, name: original, ext,
    width: info.width, height: info.height,
    fps: info.fps, fpsExact: info.fpsExact,
    duration: info.duration, hasAudio: info.hasAudio,
    face, effects: [], matteOptions: { quality: "accurate", blur: 1.5, smooth: 0 },
    addedAt: new Date().toISOString(),
  };

  const project = store.activeProject();
  project.videos.push(video);
  store.state.activeVideo = video.id;
  await saveState();
  send(res, 200, { video });
}

async function dropMedia(video) {
  const { bg, fg } = mediaNames(video);
  await fsp.rm(path.join(MEDIA, bg), { force: true });
  await fsp.rm(path.join(MEDIA, fg), { force: true });
}

async function removeVideo(res, id) {
  const { project, video } = store.locate(id);
  if (!video) return send(res, 404, { error: "unknown video" });
  project.videos = project.videos.filter((v) => v.id !== id);
  await dropMedia(video);
  if (store.state.activeVideo === id) store.state.activeVideo = null;
  await saveState();
  send(res, 200, { ok: true });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // api, ...
  const [, section, id, sub, subId] = parts;

  if (section === "state" && req.method === "GET") {
    return send(res, 200, store.snapshot(catalogue()));
  }

  if (section === "jobs" && req.method === "GET") {
    const job = jobs.get(id);
    return job ? send(res, 200, job) : send(res, 404, { error: "unknown job" });
  }

  // ------------------------------------------------------------- folders
  if (section === "folders") {
    if (req.method === "POST") {
      const { name } = await readJson(req);
      const folder = store.addFolder(name);
      await saveState();
      return send(res, 200, { folder });
    }
    if (req.method === "PATCH" && id) {
      const folder = store.folder(id);
      if (!folder) return send(res, 404, { error: "unknown folder" });
      const { name } = await readJson(req);
      if (name) folder.name = String(name).slice(0, 80);
      await saveState();
      return send(res, 200, { folder });
    }
    if (req.method === "DELETE" && id) {
      store.removeFolder(id);
      await saveState();
      return send(res, 200, { ok: true });
    }
  }

  // ------------------------------------------------------------ projects
  if (section === "projects") {
    if (req.method === "POST" && !id) {
      const { name, folderId } = await readJson(req);
      const project = store.addProject(name, folderId ?? null);
      store.state.activeProject = project.id;
      await saveState();
      return send(res, 200, { project });
    }

    const project = store.project(id);
    if (!project) return send(res, 404, { error: "unknown project" });

    if (sub === "activate" && req.method === "POST") {
      store.state.activeProject = project.id;
      store.state.activeVideo = project.videos[0]?.id || null;
      await saveState();
      return send(res, 200, { ok: true });
    }
    if (req.method === "PATCH") {
      const body = await readJson(req);
      if (body.name) project.name = String(body.name).slice(0, 80);
      if (body.folderId !== undefined) {
        project.folderId = store.folder(body.folderId) ? body.folderId : null;
      }
      await saveState();
      return send(res, 200, { project });
    }
    if (req.method === "DELETE") {
      for (const video of store.removeProject(id)) await dropMedia(video);
      await saveState();
      return send(res, 200, { ok: true });
    }
  }

  // --------------------------------------------------------- collections
  if (section === "collections") {
    if (req.method === "POST") {
      const { name } = await readJson(req);
      const collection = store.addCollection(name);
      await saveState();
      return send(res, 200, { collection });
    }
    if (req.method === "PATCH" && id) {
      const collection = store.collection(id);
      if (!collection) return send(res, 404, { error: "unknown collection" });
      const { name } = await readJson(req);
      if (name) collection.name = String(name).slice(0, 80);
      await saveState();
      return send(res, 200, { collection });
    }
    if (req.method === "DELETE" && id) {
      store.removeCollection(id);
      await saveState();
      return send(res, 200, { ok: true });
    }
  }

  // ------------------------------------------------------------- presets
  if (section === "presets") {
    // `!id` matters: POST /api/presets/:id/prepare must not land here.
    if (req.method === "POST" && !id) {
      const { name, fromVideo, fromEffect, type, params, collectionId } = await readJson(req);
      let preset;
      if (fromVideo && fromEffect) {
        const video = store.video(fromVideo);
        const fx = video?.effects.find((e) => e.id === fromEffect);
        if (!fx) return send(res, 404, { error: "unknown effect" });
        preset = store.addPreset({
          name: name || fx.name || byType(fx.type)?.label,
          type: fx.type,
          params: { ...fx.params },
          collectionId: collectionId ?? null,
        });
      } else {
        if (!byType(type)) return send(res, 400, { error: `unknown effect ${type}` });
        preset = store.addPreset({
          name, type, params: params || defaultParams(type), collectionId: collectionId ?? null,
        });
      }
      await saveState();
      return send(res, 200, { preset });
    }
    if (sub === "duplicate" && req.method === "POST") {
      const copy = store.duplicatePreset(id);
      if (!copy) return send(res, 404, { error: "unknown preset" });
      await saveState();
      return send(res, 200, { preset: copy });
    }

    // Make sure the clip used to preview this preset has its matte.
    if (sub === "prepare" && req.method === "POST") {
      const preset = store.preset(id);
      if (!preset) return send(res, 404, { error: "unknown preset" });
      const video = store.video(url.searchParams.get("video"));
      if (!video) return send(res, 400, { error: "no clip to preview against" });
      const job = startJob("preset-prepare", async (j) => {
        if (byType(preset.type)?.needsMatte) await ensureMatte(video, j);
        return { ready: true };
      });
      return send(res, 200, { job });
    }

    if (req.method === "PATCH" && id) {
      const preset = store.preset(id);
      if (!preset) return send(res, 404, { error: "unknown preset" });
      const body = await readJson(req);
      if (body.name !== undefined) {
        preset.name = String(body.name).trim().slice(0, 80) || preset.name;
      }
      if (body.params) preset.params = { ...preset.params, ...body.params };
      if (body.collectionId !== undefined) {
        preset.collectionId = store.collection(body.collectionId) ? body.collectionId : null;
      }
      await saveState();
      return send(res, 200, { preset });
    }
    if (req.method === "DELETE" && id) {
      store.removePreset(id);
      await saveState();
      return send(res, 200, { ok: true });
    }
  }

  if (section === "videos") {
    if (req.method === "POST" && !id) return addVideo(req, res);
    if (req.method === "DELETE" && id && !sub) return removeVideo(res, id);

    const video = findVideo(id);
    if (!video) return send(res, 404, { error: "unknown video" });

    // effects -------------------------------------------------------------
    if (sub === "effects") {
      if (req.method === "POST") {
        const body = await readJson(req);
        const preset = body.presetId ? store.preset(body.presetId) : null;
        if (body.presetId && !preset) return send(res, 400, { error: "unknown preset" });

        const type = preset ? preset.type : body.type;
        if (!byType(type)) return send(res, 400, { error: `unknown effect ${type}` });

        const fx = {
          id: newId("fx_"),
          type,
          name: preset ? preset.name : null,
          enabled: true,
          // Timed effects land on the whole clip; the user drags them after.
          start: 0,
          duration: null,
          params: preset ? { ...defaultParams(type), ...preset.params } : defaultParams(type),
        };
        video.effects.push(fx);
        await saveState();
        return send(res, 200, { effect: fx, video });
      }
      const fx = video.effects.find((e) => e.id === subId);
      if (!fx) return send(res, 404, { error: "unknown effect" });

      if (req.method === "PATCH") {
        const body = await readJson(req);
        if (body.params) fx.params = { ...fx.params, ...body.params };
        if (body.enabled !== undefined) fx.enabled = Boolean(body.enabled);
        if (body.name !== undefined) {
          const trimmed = String(body.name).trim().slice(0, 80);
          fx.name = trimmed || null; // empty falls back to the catalogue label
        }
        if (body.start !== undefined) {
          fx.start = Math.max(0, Math.min(Number(body.start) || 0, video.duration - 0.1));
        }
        if (body.duration !== undefined) {
          fx.duration = body.duration === null
            ? null
            : Math.max(0.1, Math.min(Number(body.duration), video.duration - fx.start));
        }
        await saveState();
        return send(res, 200, { effect: fx });
      }
      if (req.method === "DELETE") {
        video.effects = video.effects.filter((e) => e.id !== subId);
        await saveState();
        return send(res, 200, { ok: true });
      }
    }

    // prepare / render ----------------------------------------------------
    if (sub === "prepare" && req.method === "POST") {
      const job = startJob("prepare", async (j) => {
        if (needsMatte(video)) await ensureMatte(video, j);
        j.message = "Composition…";
        await writeComposition(video);
        return { ready: true };
      });
      return send(res, 200, { job });
    }

    if (sub === "render" && req.method === "POST") {
      return send(res, 200, { job: renderJob(video) });
    }
  }

  send(res, 404, { error: "unknown route" });
}

// Serve a composition for the in-page preview. A <base> tag makes the
// relative media/ paths resolve, and a tiny player drives the GSAP timeline
// off the background video's clock so the effects animate in real time.
function playable(html) {
  html = html.replace("<head>", `<head>\n    <base href="/">`);
  html = html.replace("</body>", `
    <script>
      (function () {
        var bg = document.getElementById("bg");
        var fg = document.getElementById("fg");
        var audio = document.getElementById("bg-audio");
        var tl = (window.__timelines || {})["main"];
        if (!bg || !tl) return;
        var quiet = function (p) { if (p && p.catch) p.catch(function () {}); };

        function seekAll(t) {
          t = Math.max(0, Math.min(t, bg.duration || t));
          bg.currentTime = t;
          if (fg) fg.currentTime = t;
          if (audio) audio.currentTime = t;
          tl.seek(t);
        }

        // The studio reopens this page on every edit and passes the moment it
        // wants to land on as #t=, so tweaking an effect does not throw the
        // viewer back to frame 0.
        // URLSearchParams rather than a regex: this whole script lives in a
        // template literal, where a backslash escape would be eaten before it
        // ever reaches the browser.
        var wanted = parseFloat(
          new URLSearchParams(location.hash.slice(1)).get("t") || "0");
        if (wanted > 0) {
          var ready = function (v) {
            return new Promise(function (r) {
              if (!v || v.readyState >= 2) return r();
              v.addEventListener("loadeddata", r, { once: true });
              setTimeout(r, 4000);
            });
          };
          Promise.all([ready(bg), ready(fg), ready(audio)]).then(function () {
            seekAll(wanted);
            parent.postMessage({ type: "ready", t: wanted }, "*");
          });
        } else {
          parent.postMessage({ type: "ready", t: 0 }, "*");
        }

        function frame() {
          var t = bg.currentTime;
          tl.seek(t);
          // The alpha WebM decodes slower than the source and drifts out of
          // step, which breaks the occlusion. Nudge it back when it strays.
          if (fg && Math.abs(fg.currentTime - t) > 0.08) fg.currentTime = t;
          if (audio && Math.abs(audio.currentTime - t) > 0.15) audio.currentTime = t;
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);

        function play() { quiet(bg.play()); if (fg) quiet(fg.play()); if (audio) quiet(audio.play()); }
        function pause() { bg.pause(); if (fg) fg.pause(); if (audio) audio.pause(); }
        bg.addEventListener("ended", pause);

        window.addEventListener("message", function (e) {
          if (e.data === "play") play();
          if (e.data === "pause") pause();
          if (e.data && e.data.type === "seek") seekAll(e.data.t);
          if (e.data === "restart") {
            bg.currentTime = 0;
            if (fg) fg.currentTime = 0;
            if (audio) audio.currentTime = 0;
            play();
          }
        });
      })();
    <\/script>
  </body>`);

  return html;
}

async function servePreview(res, id) {
  const video = findVideo(id);
  if (!video) return send(res, 404, { error: "unknown video" }, "text/plain");
  const { bg, fg } = mediaNames(video);
  send(res, 200, playable(compose(video, { bgFile: bg, fgFile: fg })), "text/html");
}

// The library's preview: the clip with this preset as its only effect, so you
// can tune a look without it fighting whatever else is on the timeline.
async function servePresetPreview(res, presetId, videoId) {
  const preset = store.preset(presetId);
  if (!preset) return send(res, 404, { error: "unknown preset" }, "text/plain");

  const video = findVideo(videoId) || store.activeProject()?.videos[0];
  if (!video) {
    return send(res, 200, `<!doctype html><meta charset="utf-8">
      <body style="margin:0;display:flex;align-items:center;justify-content:center;
                   height:100vh;background:#0d1017;color:#8b97a8;
                   font:13px -apple-system,system-ui,sans-serif">
        Ajoute un clip à un projet pour prévisualiser tes préréglages.
      </body>`, "text/html");
  }

  const { bg, fg } = mediaNames(video);
  const solo = {
    ...video,
    effects: [{
      id: "fx_preset",
      type: preset.type,
      name: preset.name,
      enabled: true,
      start: 0,
      duration: null,
      params: preset.params,
    }],
  };
  send(res, 200, playable(compose(solo, { bgFile: bg, fgFile: fg })), "text/html");
}

// ---------------------------------------------------------------- guard

// The studio drives ffmpeg, writes to disk and deletes media, so only the
// studio's own page may talk to it.
//
// Host: a page on another domain can rebind its DNS to 127.0.0.1 and reach us
// under its own hostname; a Host we do not recognise is refused outright.
// Origin: browsers attach it to every cross-site request, including the
// "simple" POSTs that skip the CORS preflight. Absent (curl, the CLI) is fine —
// the socket only listens on loopback, so that is a local process.
let allowedHosts = new Set();
let allowedOrigins = new Set();

function trust(port) {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  allowedHosts = new Set(hosts);
  allowedOrigins = new Set(hosts.map((h) => `http://${h}`));
}

function refused(req) {
  if (!allowedHosts.has(String(req.headers.host || "").toLowerCase())) return "hôte non autorisé";
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins.has(origin.toLowerCase())) return "origine non autorisée";
  return null;
}

// --------------------------------------------------------------------- main

async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  const reason = refused(req);
  if (reason) {
    console.warn(`  refusé (${reason}) : ${req.method} ${p} · host=${req.headers.host} origin=${req.headers.origin}`);
    return send(res, 403, { error: `Requête refusée : ${reason}.` });
  }

  try {
    if (p.startsWith("/api/")) return await handleApi(req, res, url);
    if (p.startsWith("/preview/")) return await servePreview(res, p.split("/")[2]);
    if (p.startsWith("/preview-preset/")) {
      return await servePresetPreview(res, p.split("/")[2], url.searchParams.get("video"));
    }
    if (p.startsWith("/media/")) {
      return serveFile(req, res, path.join(MEDIA, path.basename(p)));
    }
    if (p.startsWith("/renders/")) {
      return serveFile(req, res, path.join(RENDERS, path.basename(p)));
    }
    if (p === "/" || p === "/index.html") {
      return serveFile(req, res, path.join(UI, "index.html"));
    }
    const asset = path.join(UI, path.basename(p));
    if (fs.existsSync(asset)) return serveFile(req, res, asset);
    send(res, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: String(error.message || error) });
  }
}

function listen(server, port, attemptsLeft) {
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
        console.log(`  port ${port} occupé (HyperFrames Studio ?), essai sur ${port + 1}`);
        resolve(listen(server, port + 1, attemptsLeft - 1));
      } else reject(error);
    });
    // Loopback only: without a host, Node listens on every interface and the
    // studio is reachable by anyone on the same network.
    server.listen(port, "127.0.0.1", () => resolve(port));
  });
}

async function main() {
  for (const binary of ["ffmpeg", "ffprobe"]) {
    if (!media.have(binary)) {
      console.error(`\n${binary} introuvable. Installe-le : brew install ffmpeg\n`);
      process.exit(1);
    }
  }
  media.buildTools();
  await fsp.mkdir(MEDIA, { recursive: true });
  await fsp.mkdir(RENDERS, { recursive: true });
  await store.load();

  if (store.recovery) {
    const { quarantined, restored, backup } = store.recovery;
    console.warn(`\n  ⚠ studio.json était illisible. Mis de côté, intact : ${path.basename(quarantined)}`);
    console.warn(restored
      ? `    Restauré depuis la dernière sauvegarde valide (${path.basename(backup)}).`
      : `    Aucune sauvegarde valide : démarrage sur une bibliothèque vide.`);
  }

  const wanted = Number(process.env.PORT || process.argv[2] || 3002);
  const server = http.createServer(handler);
  const port = await listen(server, wanted, 12);
  trust(port);

  console.log(`\n  Studio prêt    http://localhost:${port}`);
  const active = store.activeProject();
  console.log(`  ${store.state.projects.length} projet(s) · ` + `${active ? active.videos.length : 0} vidéo(s) dans « ${active ? active.name : "—"} »\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

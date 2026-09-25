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
import { compose, composeSequence, needsMatte, clipsNeedingMatte, TRANSITIONS } from "../lib/compose.mjs";
import { ASPECTS, SIZES, FITS, FOCUSES, FILLS, normaliseFormat } from "../lib/format.mjs";
import * as media from "../lib/media.mjs";
import { makeGuard } from "../lib/guard.mjs";

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

// Finished jobs stay pollable for a while, then go: every preview creates one,
// and a long session would otherwise accumulate them without limit.
const JOB_TTL_MS = 10 * 60 * 1000;

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
    })
    .finally(() => {
      setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
    });
  return job;
}

// --------------------------------------------------------------- pipeline

function mediaNames(video) {
  return { bg: `${video.id}-bg${video.ext}`, fg: `${video.id}-fg.webm` };
}

// One cut-out per clip at a time. Two previews landing close together (the
// montage and the library, or an add followed by a tweak) used to start two
// encoders writing the same WebM. Late callers now join the build already in
// flight and see its progress.
const mattesInFlight = new Map(); // videoId -> { promise, jobs: Set }

async function ensureMatte(video, job) {
  const { bg, fg } = mediaNames(video);
  const target = path.join(MEDIA, fg);
  try {
    await fsp.access(target);
    if (video.matteSignature === matteSignature(video)) return fg;
  } catch { /* needs building */ }

  const running = mattesInFlight.get(video.id);
  if (running) {
    running.jobs.add(job);
    job.message = "Découpe déjà en cours…";
    return running.promise;
  }

  const entry = { jobs: new Set([job]), promise: null };
  for (const j of entry.jobs) j.message = "Découpe de la personne image par image…";

  entry.promise = (async () => {
    const info = {
      width: video.width, height: video.height,
      fps: video.fps, fpsExact: video.fpsExact, duration: video.duration,
    };
    const result = await media.makeMatte(
      path.join(MEDIA, bg), info, target, video.matteOptions || {},
      (p) => { for (const j of entry.jobs) j.progress = p; });

    // The clip may have been deleted while we were cutting it out.
    if (!findVideo(video.id)) {
      await fsp.rm(target, { force: true });
      throw new Error("clip supprimé pendant la découpe");
    }
    video.matteSignature = matteSignature(video);
    video.matteMissing = result.missing;
    await saveState();
    return fg;
  })().finally(() => mattesInFlight.delete(video.id));

  mattesInFlight.set(video.id, entry);
  return entry.promise;
}

const matteSignature = (video) =>
  JSON.stringify(video.matteOptions || {}) + "|" + video.ext;

const filesOf = (video) => {
  const { bg, fg } = mediaNames(video);
  return { bgFile: bg, fgFile: fg };
};

// A clip is previewed and rendered in its project's output format.
const formatOf = (videoId) => store.locate(videoId).project?.sequence?.format || {};

// The project's shots, each resolved to its clip. Shots whose clip is gone are
// skipped rather than breaking the whole sequence.
function shotsOf(project) {
  return project.sequence.shots
    .map((shot) => ({ ...shot, video: project.videos.find((v) => v.id === shot.videoId) }))
    .filter((shot) => shot.video);
}

async function writeAtomic(file, contents) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, contents);
  await fsp.rename(tmp, file);
}

// Renders used to share index.html with the preview, so tweaking an effect
// mid-render could swap the composition out from under HyperFrames. Now each
// render is composed when you click — a snapshot — into a file of its own.
// They also run one at a time: each already starts several Chrome workers,
// and two in parallel only thrash.
let renderQueue = Promise.resolve();

function queueRender({ name, html, mattes }) {
  return startJob("render", (job) => {
    job.message = "En attente de la fin du rendu précédent…";
    const turn = renderQueue.then(() => runRender({ name, html, mattes }, job));
    renderQueue = turn.catch(() => {});
    return turn;
  });
}

async function runRender({ name, html, mattes }, job) {
  // The composition is already fixed; only the cut-outs it points at may
  // still need building.
  for (const video of mattes) {
    const live = findVideo(video.id);
    if (!live) throw new Error("un clip de ce rendu a été supprimé");
    await ensureMatte(live, job);
  }

  // Root level, so the composition's media/ paths resolve unchanged.
  const composition = `render-${job.id}.html`;
  await fsp.writeFile(path.join(ROOT, composition), html);
  // index.html mirrors the last rendered composition, for `npm run check`.
  await writeAtomic(path.join(ROOT, "index.html"), html);

  job.message = "Rendu HyperFrames…";
  job.progress = 0;

  const output = path.join("renders", `${slug(name)}-${Date.now()}.mp4`);
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn("npx", [
        "--yes", HYPERFRAMES, "render", "--composition", composition, "--output", output,
      ], {
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
  } finally {
    await fsp.rm(path.join(ROOT, composition), { force: true });
  }

  return { output: `/${output}` };
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
    info = await media.probe(target);
  } catch (error) {
    await fsp.rm(target, { force: true });
    return send(res, 400, { error: `Fichier illisible : ${error.message}` });
  }

  if (info.rotation) {
    await media.flatten(target, info.rotation);
    info = await media.probe(target);
  }

  let face = null;
  try { face = await media.detectFace(target, 24); } catch { /* optional */ }

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
  store.forgetClip(project, id);
  await dropMedia(video);
  if (store.state.activeVideo === id) store.state.activeVideo = null;
  await saveState();
  send(res, 200, { ok: true });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // api, ...
  const [, section, id, sub, subId] = parts;

  if (section === "state" && req.method === "GET") {
    return send(res, 200, {
      ...store.snapshot(catalogue()),
      options: { aspects: ASPECTS, sizes: SIZES, fits: FITS, focuses: FOCUSES, fills: FILLS, transitions: TRANSITIONS },
    });
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

    // ------------------------------------------------ output format
    if (sub === "format" && req.method === "PATCH") {
      const body = await readJson(req);
      project.sequence.format = normaliseFormat({ ...project.sequence.format, ...body });
      await saveState();
      return send(res, 200, { format: project.sequence.format });
    }

    // ------------------------------------------------------- shots
    if (sub === "shots") {
      if (req.method === "POST" && !subId) {
        const { videoId, in: cutIn, out } = await readJson(req);
        const shot = store.addShot(project, videoId, { in: cutIn || 0, out: out ?? null });
        if (!shot) return send(res, 400, { error: "ce clip n'appartient pas au projet" });
        await saveState();
        return send(res, 200, { shot });
      }

      const shot = project.sequence.shots.find((x) => x.id === subId);
      if (!shot) return send(res, 404, { error: "unknown shot" });
      const clip = project.videos.find((v) => v.id === shot.videoId);

      if (req.method === "PATCH") {
        const body = await readJson(req);
        const length = clip ? clip.duration : Infinity;
        if (body.in !== undefined) {
          shot.in = Math.max(0, Math.min(Number(body.in) || 0, length - 0.1));
        }
        if (body.out !== undefined) {
          shot.out = body.out === null
            ? null
            : Math.max(shot.in + 0.1, Math.min(Number(body.out), length));
        }
        // An in-point dragged past the out-point pushes it along.
        if (shot.out !== null && shot.out < shot.in + 0.1) shot.out = shot.in + 0.1;
        if (body.transition !== undefined) {
          shot.transition = TRANSITIONS.some((t) => t.value === body.transition)
            ? body.transition
            : "cut";
        }
        if (body.index !== undefined) store.moveShot(project, shot.id, Number(body.index));
        await saveState();
        return send(res, 200, { shot });
      }
      if (req.method === "DELETE") {
        store.removeShot(project, shot.id);
        await saveState();
        return send(res, 200, { ok: true });
      }
    }

    // Everything the sequence preview needs on disk: its clips' cut-outs.
    if (sub === "prepare" && req.method === "POST") {
      const job = startJob("prepare-sequence", async (j) => {
        for (const video of clipsNeedingMatte(shotsOf(project))) await ensureMatte(video, j);
        return { ready: true };
      });
      return send(res, 200, { job });
    }

    if (sub === "render" && req.method === "POST") {
      const shots = shotsOf(project);
      if (!shots.length) return send(res, 400, { error: "la séquence est vide" });
      return send(res, 200, {
        job: queueRender({
          name: project.name,
          html: composeSequence({ shots, format: project.sequence.format, files: filesOf }),
          mattes: clipsNeedingMatte(shots),
        }),
      });
    }

    if (req.method === "PATCH" && !sub) {
      const body = await readJson(req);
      if (body.name) project.name = String(body.name).slice(0, 80);
      if (body.folderId !== undefined) {
        project.folderId = store.folder(body.folderId) ? body.folderId : null;
      }
      await saveState();
      return send(res, 200, { project });
    }
    if (req.method === "DELETE" && !sub) {
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
    // The preview composes in memory; all it needs on disk is the cut-out.
    if (sub === "prepare" && req.method === "POST") {
      const job = startJob("prepare", async (j) => {
        if (needsMatte(video)) await ensureMatte(video, j);
        store.state.activeVideo = video.id;
        await saveState();
        return { ready: true };
      });
      return send(res, 200, { job });
    }

    if (sub === "render" && req.method === "POST") {
      return send(res, 200, {
        job: queueRender({
          name: video.name,
          html: compose(video, filesOf(video), formatOf(video.id)),
          mattes: needsMatte(video) ? [video] : [],
        }),
      });
    }
  }

  send(res, 404, { error: "unknown route" });
}

// Serve a composition for the in-page preview. A <base> tag makes the
// relative media/ paths resolve, and a small player stands in for the
// HyperFrames runtime: it windows every video and audio element by its
// data-start / data-duration / data-media-start, and drives the GSAP timeline
// off one clock — so a sequence of several shots previews like it renders.
function playable(html) {
  html = html.replace("<head>", `<head>\n    <base href="/">`);
  html = html.replace("</body>", `
    <script>
      (function () {
        var root = document.getElementById("root");
        var tl = (window.__timelines || {})["main"];
        if (!root || !tl) return;
        var total = parseFloat(root.getAttribute("data-duration")) || 0;
        var quiet = function (p) { if (p && p.catch) p.catch(function () {}); };

        var media = Array.prototype.map.call(
          document.querySelectorAll("video[data-start], audio[data-start]"),
          function (el) {
            var start = parseFloat(el.getAttribute("data-start")) || 0;
            return {
              el: el, start: start,
              end: start + (parseFloat(el.getAttribute("data-duration")) || 0),
              from: parseFloat(el.getAttribute("data-media-start")) || 0,
              video: el.tagName === "VIDEO",
              // Each shot's footage is the clock while it plays; the cut-out
              // and the audio follow it.
              master: el.id.indexOf("bg_") === 0,
            };
          });

        var t = 0, playing = false, last = null;
        window.__studioTime = function () { return t; };
        window.__studioDuration = total;

        function apply(hard) {
          tl.seek(t);
          media.forEach(function (m) {
            var on = t >= m.start && t < m.end;
            if (m.video) m.el.style.visibility = on ? "" : "hidden";
            if (!on) { if (!m.el.paused) m.el.pause(); return; }
            var want = m.from + (t - m.start);
            var slack = m.master ? 0.3 : m.video ? 0.08 : 0.2;
            if (hard || Math.abs(m.el.currentTime - want) > slack) m.el.currentTime = want;
            if (playing && m.el.paused) quiet(m.el.play());
            if (!playing && !m.el.paused) m.el.pause();
          });
        }

        function masterAt(time) {
          for (var i = 0; i < media.length; i++) {
            var m = media[i];
            if (m.master && time >= m.start && time < m.end) return m;
          }
          return null;
        }

        function frame(now) {
          if (playing) {
            var dt = last === null ? 0 : (now - last) / 1000;
            last = now;
            var m = masterAt(t);
            if (m && !m.el.paused && !m.el.seeking && m.el.readyState >= 3) {
              // Follow the footage while it plays; never step backwards.
              t = Math.max(t, m.start + (m.el.currentTime - m.from));
            } else {
              // Across a cut the next shot's video has not started yet: the
              // wall clock carries us over.
              t += dt;
            }
            if (t >= total) {
              t = total;
              playing = false;
              parent.postMessage({ type: "ended" }, "*");
            }
            apply(false);
          } else {
            last = null;
          }
          requestAnimationFrame(frame);
        }

        function seek(to) { t = Math.max(0, Math.min(to, total)); apply(true); }

        // The studio reopens this page on every edit and passes the moment it
        // wants to land on as #t=. URLSearchParams rather than a regex: this
        // whole script lives in a template literal, where a backslash escape
        // would be eaten before it reached the browser.
        var wanted = parseFloat(new URLSearchParams(location.hash.slice(1)).get("t") || "0");
        var ready = function (el) {
          return new Promise(function (r) {
            if (el.readyState >= 2) return r();
            el.addEventListener("loadeddata", r, { once: true });
            setTimeout(r, 4000);
          });
        };
        Promise.all(media.map(function (m) { return ready(m.el); })).then(function () {
          seek(wanted);
          parent.postMessage({ type: "ready", t: t }, "*");
        });
        requestAnimationFrame(frame);

        window.addEventListener("message", function (e) {
          var d = e.data;
          if (d === "play") { if (t >= total) t = 0; playing = true; apply(true); }
          if (d === "pause") { playing = false; apply(false); }
          if (d === "restart") { t = 0; playing = true; apply(true); }
          if (d && d.type === "seek") seek(d.t);
        });
      })();
    <\/script>
  </body>`);

  return html;
}

async function servePreview(res, id) {
  const video = findVideo(id);
  if (!video) return send(res, 404, { error: "unknown video" }, "text/plain");
  send(res, 200, playable(compose(video, filesOf(video), formatOf(video.id))), "text/html");
}

// The whole sequence of a project, as it will render.
async function serveSequencePreview(res, projectId) {
  const project = store.project(projectId);
  if (!project) return send(res, 404, { error: "unknown project" }, "text/plain");
  const shots = shotsOf(project);
  if (!shots.length) {
    return send(res, 200, `<!doctype html><meta charset="utf-8">
      <body style="margin:0;display:flex;align-items:center;justify-content:center;
                   height:100vh;background:#0d1017;color:#8b97a8;
                   font:13px -apple-system,system-ui,sans-serif;text-align:center;padding:24px">
        La séquence est vide. Ajoute des plans depuis la liste des vidéos (＋ Séquence).
      </body>`, "text/html");
  }
  const html = composeSequence({ shots, format: project.sequence.format, files: filesOf });
  send(res, 200, playable(html), "text/html");
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
  send(res, 200, playable(compose(solo, filesOf(video), formatOf(video.id))), "text/html");
}

// ---------------------------------------------------------------- guard

// Set once we know which port we actually got; see lib/guard.mjs.
let refused = () => "studio pas encore prêt";

// --------------------------------------------------------------------- main

async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  const reason = refused(req.headers);
  if (reason) {
    console.warn(`  refusé (${reason}) : ${req.method} ${p} · host=${req.headers.host} origin=${req.headers.origin}`);
    return send(res, 403, { error: `Requête refusée : ${reason}.` });
  }

  try {
    if (p.startsWith("/api/")) return await handleApi(req, res, url);
    if (p.startsWith("/preview/")) return await servePreview(res, p.split("/")[2]);
    if (p.startsWith("/preview-sequence/")) return await serveSequencePreview(res, p.split("/")[2]);
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
  refused = makeGuard(port);

  console.log(`\n  Studio prêt    http://localhost:${port}`);
  const active = store.activeProject();
  console.log(`  ${store.state.projects.length} projet(s) · ` + `${active ? active.videos.length : 0} vidéo(s) dans « ${active ? active.name : "—"} »\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

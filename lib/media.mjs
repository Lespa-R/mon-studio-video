// Media analysis: probe a clip, find the face, cut the person out.
// Thin wrappers around ffprobe/ffmpeg and the two Swift Vision helpers.
//
// Everything that can take more than a few milliseconds is async: the studio
// calls these from its HTTP server, and a synchronous child process would
// freeze every other request — previews, job polling — until it returned.

import { spawn, spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TOOLS = path.join(ROOT, "tools");

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("error", (error) => reject(new Error(`${command}: ${error.message}`)));
    proc.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}\n${stderr}`)));
  });
}

// Startup checks stay synchronous: they run once, before the server listens.
export function have(binary) {
  return spawnSync("sh", ["-lc", `command -v ${binary}`]).status === 0;
}

export function buildTools() {
  const r = spawnSync(path.join(TOOLS, "build.sh"), [], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tools/build.sh failed:\n${r.stderr || r.stdout}`);
}

// Pure: ffprobe's JSON → the fields the studio uses.
export function parseProbe(data, hasAudio) {
  const stream = data.streams?.[0];
  if (!stream) throw new Error("no video stream");
  const [n, d] = String(stream.r_frame_rate || "30/1").split("/").map(Number);
  return {
    width: stream.width,
    height: stream.height,
    fps: d ? n / d : 30,
    fpsExact: stream.r_frame_rate || "30/1",
    duration: Number(Number(data.format?.duration || 0).toFixed(3)),
    rotation: Number(
      stream.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0),
    hasAudio,
  };
}

export async function probe(file) {
  const [video, audio] = await Promise.all([
    capture("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,nb_frames:stream_side_data=rotation",
      "-show_entries", "format=duration",
      "-of", "json",
      file,
    ]),
    capture("ffprobe", [
      "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
      "-of", "csv=p=0", file,
    ]),
  ]);
  return parseProbe(JSON.parse(video), audio.trim().length > 0);
}

// Bake a rotation matrix into the pixels — Vision and the browser would
// otherwise disagree about which way is up. Returns true if it rewrote the file.
export async function flatten(file, rotation) {
  if (!rotation) return false;
  const tmp = `${file}.upright.mp4`;
  try {
    await capture("ffmpeg", [
      "-v", "error", "-i", file,
      "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart", tmp, "-y",
    ]);
    await fsp.rename(tmp, file);
  } finally {
    await fsp.rm(tmp, { force: true });
  }
  return true;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Pure: per-frame face boxes → one placement for the whole clip.
export function summariseFaces(frames) {
  const found = frames.filter((f) => f && f.chin !== undefined);
  if (!found.length) return null;
  return {
    centreX: Math.round(median(found.map((f) => f.cx))),
    chinMin: Math.min(...found.map((f) => f.chin)),
    chinMax: Math.max(...found.map((f) => f.chin)),
    faceHeight: Math.round(median(found.map((f) => f.h))),
    coverage: Number((found.length / frames.length).toFixed(2)),
  };
}

export async function detectFace(file, samples = 24) {
  const raw = await capture(path.join(TOOLS, "facedet"), [file, String(samples)]);
  return summariseFaces(JSON.parse(raw.slice(raw.indexOf("{"))).frames);
}

// Cut the person out of every frame and encode a VP9 WebM with a real alpha
// channel. onProgress receives a 0..1 estimate.
//
// The encode goes to a sibling file and is renamed into place only once ffmpeg
// has finished, so `target` is either absent or complete — never the partial
// output of a run that crashed, which a later call would happily reuse.
export function makeMatte(file, info, target, opts = {}, onProgress = null) {
  const partial = target.replace(/\.webm$/, ".partial.webm");

  const encode = new Promise((resolve, reject) => {
    const cutter = spawn(path.join(TOOLS, "personmatte"), [
      file,
      "--quality", opts.quality || "accurate",
      "--blur", String(opts.blur ?? 1.5),
      "--smooth", String(opts.smooth ?? 0),
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const encoder = spawn("ffmpeg", [
      "-v", "error",
      "-f", "rawvideo", "-pix_fmt", "rgba",
      "-s", `${info.width}x${info.height}`,
      "-r", info.fpsExact,
      "-i", "-",
      "-an",
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
      "-crf", "20", "-b:v", "0",
      "-auto-alt-ref", "0",   // required for alpha
      "-g", "1",              // every frame a keyframe: the renderer seeks
      "-deadline", "good", "-cpu-used", String(opts.cpuUsed ?? 4),
      "-row-mt", "1",
      "-progress", "pipe:2", "-nostats",
      partial, "-y",
    ], { stdio: ["pipe", "ignore", "pipe"] });

    const totalFrames = Math.max(1, Math.round(info.duration * info.fps));
    let cutterLog = "";
    let encoderLog = "";

    cutter.stderr.on("data", (d) => { cutterLog += d; });
    encoder.stderr.on("data", (d) => {
      const text = String(d);
      encoderLog += text;
      if (!onProgress) return;
      const m = /frame=\s*(\d+)/.exec(text);
      if (m) onProgress(Math.min(1, Number(m[1]) / totalFrames));
    });

    cutter.stdout.pipe(encoder.stdin);
    cutter.on("error", reject);
    encoder.on("error", reject);
    encoder.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`matte encode failed (${code})\n${encoderLog}\n${cutterLog}`));
      }
      const missing = /(\d+) without a person/.exec(cutterLog);
      resolve({ missing: missing ? Number(missing[1]) : 0 });
    });
  });

  return encode.then(
    async (result) => {
      await fsp.rename(partial, target);
      return result;
    },
    async (error) => {
      await fsp.rm(partial, { force: true });
      throw error;
    },
  );
}

// ------------------------------------------------------------ subtitles

const TRANSCRIBER = path.join(TOOLS, "Transcribe.app");

// What the transcriber's error codes mean, for the person reading the studio.
const TRANSCRIBE_ERRORS = {
  "not-authorized":
    "macOS n'autorise pas la reconnaissance vocale pour « Mon Studio – Transcription ». " +
    "Autorise-la dans Réglages Système › Confidentialité et sécurité › Reconnaissance vocale, puis relance.",
  "no-on-device":
    "La reconnaissance vocale hors ligne n'est pas installée pour cette langue sur ce Mac. " +
    "Ajoute la langue dans Réglages Système › Clavier › Dictée, ou choisis une autre langue.",
  unavailable: "La reconnaissance vocale n'est pas disponible pour cette langue sur ce Mac.",
};

// Pure: ffmpeg's silencedetect log → [{ start, end }].
export function parseSilences(log) {
  const out = [];
  let open = null;
  for (const line of String(log).split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    if (e && open !== null) { out.push({ start: open, end: Number(e[1]) }); open = null; }
  }
  return out;
}

async function silences(file) {
  // silencedetect reports on stderr; capture() only returns stdout.
  const log = await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn",
      "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", reject);
    proc.on("close", () => resolve(err));
  });
  return parseSilences(log);
}

// One run of the transcriber app on a WAV file → [{ w, s, e }].
function runTranscriber(wav, lang, out) {
  return new Promise((resolve, reject) => {
    // -W waits for it to quit, -n starts a fresh instance, -g keeps it in
    // the background. See tools/transcribe.swift for why it is an app.
    const proc = spawn("open", ["-W", "-n", "-g", TRANSCRIBER, "--args", wav, lang, out],
      { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", reject);
    proc.on("close", async () => {
      let result;
      try {
        result = JSON.parse(await fsp.readFile(out, "utf8"));
      } catch {
        return reject(new Error(`La transcription n'a rien produit.${err ? `\n${err}` : ""}`));
      }
      if (result.error) {
        return reject(new Error(TRANSCRIBE_ERRORS[result.error] || `Transcription impossible : ${result.detail || result.error}`));
      }
      resolve(result.words || []);
    });
  });
}

// Transcribe a clip's audio on this Mac. Long clips go in pieces cut at
// pauses; the words come back on the clip's own timeline.
export async function transcribe(file, { lang = "fr-FR", duration, chunkPlan, workDir, onProgress } = {}) {
  await fsp.mkdir(workDir, { recursive: true });
  const plan = chunkPlan(duration, duration > 55 ? await silences(file) : []);
  const words = [];
  try {
    for (const [i, part] of plan.entries()) {
      const wav = path.join(workDir, `part-${i}.wav`);
      const out = path.join(workDir, `part-${i}.json`);
      await capture("ffmpeg", ["-v", "error", "-y", "-ss", String(part.start), "-to", String(part.end),
        "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
      for (const w of await runTranscriber(wav, lang, out)) {
        words.push({ w: w.w, s: w.s + part.start, e: w.e + part.start });
      }
      if (onProgress) onProgress((i + 1) / plan.length);
    }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
  return words;
}

// ------------------------------------------------------------- people

// Detect the people in a clip, `fps` samples a second (tools/persontrack).
// Returns the raw detections; lib/tracking.mjs links them into tracks.
export function detectPeople(file, { fps = 8, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(path.join(TOOLS, "persontrack"), [file, String(fps)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => {
      const text = String(d);
      err += text;
      const m = /progress ([\d.]+)/g;
      let hit;
      let last;
      while ((hit = m.exec(text))) last = Number(hit[1]);
      if (onProgress && last !== undefined) onProgress(last);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`suivi des personnes impossible (${code})\n${err}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`suivi des personnes illisible : ${e.message}`)); }
    });
  });
}

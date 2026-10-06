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
import { parseWhisperWords, fitToSpeech, parseVad } from "./textcut.mjs";

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
    // HDR (HLG from most phones, PQ for HDR10) or wide-gamut / 10-bit video.
    // The HyperFrames renderer drops such a background layer entirely (only
    // the cut-out is left in the MP4), so it gets an SDR working copy.
    hdr: isHdr(stream),
  };
}

export function isHdr(stream = {}) {
  return ["arib-std-b67", "smpte2084"].includes(stream.color_transfer)
    || stream.color_primaries === "bt2020"
    || /1[02]le$|p010/.test(stream.pix_fmt || "");
}

// Every video the studio encodes is 8-bit 4:2:0 tagged BT.709, with a
// keyframe each second (the renderer seeks). A HLG source re-tagged this way
// looks right in SDR — HLG was designed for it; PQ (HDR10) comes out flatter.
// The tags must be set on the frames (setparams): x264 takes them from the
// frames, so output options alone would keep "HLG / BT.2020".
export const SDR_TAGS = "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709";
const SDR = (fps = 30) => [
  "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
  "-g", String(Math.max(1, Math.round(fps))),
];

export async function probe(file) {
  const [video, audio] = await Promise.all([
    capture("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,nb_frames,pix_fmt,color_transfer,color_primaries:stream_side_data=rotation",
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
//
// The same pass turns an HDR video into its SDR working copy (see isHdr).
export async function flatten(file, rotation, { hdr = false, fps = 30 } = {}) {
  if (!rotation && !hdr) return false;
  const tmp = `${file}.upright.mp4`;
  try {
    await capture("ffmpeg", [
      "-v", "error", "-i", file, "-vf", SDR_TAGS,
      "-c:v", "libx264", "-crf", "16", "-preset", "medium", ...SDR(fps),
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
      "--window", String(opts.window ?? 2),
      "--model", ["subject", "none"].includes(opts.model) ? opts.model : "person",
      ...(opts.maskVideo ? ["--mask-video", opts.maskVideo] : []),
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

// ------------------------------------------------------------- Whisper
//
// whisper.cpp (Homebrew « whisper-cpp ») and its models in models/:
// ggml-large-v3-turbo-q8_0.bin for the words, ggml-silero-v5.1.2.bin to tell
// speech from music and noise (Whisper invents sentences on music). Unlike the
// Apple transcriber, it needs no macOS permission.

const MODELS = path.join(ROOT, "models");
const WHISPER_MODEL = path.join(MODELS, "ggml-large-v3-turbo-q8_0.bin");
const VAD_MODEL = path.join(MODELS, "ggml-silero-v5.1.2.bin");
const BREW_BIN = ["/opt/homebrew/bin", "/usr/local/bin"];

function findBinary(name) {
  for (const dir of BREW_BIN) {
    const file = path.join(dir, name);
    if (spawnSync("test", ["-x", file]).status === 0) return file;
  }
  return have(name) ? name : null;
}

// What is installed, checked once (the server is restarted after installing).
let whisperFound;
export function whisperStatus() {
  if (!whisperFound) {
    const cli = findBinary("whisper-cli");
    const vad = findBinary("whisper-vad-speech-segments");
    const exists = (f) => spawnSync("test", ["-s", f]).status === 0;
    whisperFound = {
      cli, vad: vad && exists(VAD_MODEL) ? vad : null,
      model: exists(WHISPER_MODEL) ? WHISPER_MODEL : null,
    };
  }
  const { cli, model, vad } = whisperFound;
  return { available: Boolean(cli && model), vad: Boolean(vad) };
}

// A level per 10 ms (dB, 0 = silence floor at -90 dB) of a 16 kHz mono
// s16le WAV, for placing cut edges in the quietest spot (textcut settleCuts).
export function energyOf(wavBuffer) {
  const data = wavBuffer.subarray(44);
  const hop = 160; // 10 ms at 16 kHz
  const n = Math.floor(data.length / 2 / hop);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < hop; k++) {
      const v = data.readInt16LE((i * hop + k) * 2) / 32768;
      sum += v * v;
    }
    const db = 10 * Math.log10(sum / hop + 1e-12);
    out[i] = Math.max(0, Math.min(255, Math.round(db + 90)));
  }
  return out;
}

// Transcribe a whole file → { words, speech, energy }, all in its own time.
export async function transcribeWhisper(file, { lang = "fr-FR", workDir, onProgress } = {}) {
  whisperStatus();
  const { cli, model, vad } = whisperFound;
  if (!cli || !model) {
    throw new Error("Whisper n'est pas installé : brew install whisper-cpp, et le modèle dans models/ (voir docs/ARCHITECTURE.md).");
  }
  await fsp.mkdir(workDir, { recursive: true });
  try {
    const wav = path.join(workDir, "audio.wav");
    await capture("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    const energy = energyOf(await fsp.readFile(wav));

    let speech = [];
    if (vad) {
      try { speech = parseVad(await capture(vad, ["-vm", VAD_MODEL, "-f", wav])); } catch { /* optional */ }
    }

    const out = path.join(workDir, "words");
    await new Promise((resolve, reject) => {
      const proc = spawn(cli, [
        "-m", model, "-l", lang.slice(0, 2), "-f", wav,
        // One segment per word, with DTW token times (needs flash
        // attention off): see parseWhisperWords.
        "-ml", "1", "-sow", "-ojf", "-of", out, "-np", "-pp",
        "-nfa", "-dtw", "large.v3.turbo",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      proc.stderr.on("data", (d) => {
        const text = String(d);
        err += text;
        const m = /progress =\s*(\d+)%/g;
        let hit;
        let last;
        while ((hit = m.exec(text))) last = Number(hit[1]);
        if (onProgress && last !== undefined) onProgress(last / 100);
      });
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Whisper a échoué (${code})\n${err.slice(-1500)}`)));
    });
    const words = fitToSpeech(parseWhisperWords(JSON.parse(await fsp.readFile(`${out}.json`, "utf8"))), speech);
    return { words, speech, energy };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------- shots
//
// PySceneDetect runs in the studio's own virtualenv (.venv, Python 3.12 from
// Homebrew): `python3.12 -m venv .venv && .venv/bin/pip install scenedetect`.

const VENV_PYTHON = path.join(ROOT, ".venv", "bin", "python");
let scenesFound;
export function scenesStatus() {
  if (scenesFound === undefined) {
    scenesFound = spawnSync(VENV_PYTHON, ["-c", "import scenedetect"], { stdio: "ignore" }).status === 0;
  }
  return { available: scenesFound };
}

// The shots of a file → { fps, duration, scenes: [{ start, end }] }.
export function detectScenes(file, { sensitivity = "normal", minShot = 1, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(VENV_PYTHON, [path.join(TOOLS, "scenes.py"), file,
      "--sensitivity", sensitivity, "--min", String(minShot)], { stdio: ["ignore", "pipe", "pipe"] });
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
      if (code !== 0) return reject(new Error(`détection des plans impossible (${code})\n${err.slice(-1500)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`détection des plans illisible : ${e.message}`)); }
    });
  });
}

// One frame of `file` at `t` seconds → a small JPEG (shot thumbnails).
export async function frameJpeg(file, t, target, width = 320) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await capture("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, t)), "-i", file,
    "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "5", target]);
}

// ------------------------------------------------------------- pinned text
//
// tools/scenetrack.py (OpenCV, in .venv) follows a spot of the scenery while
// the camera moves: see lib/pins.mjs for what comes back.

export function trackScene(file, { t, x, y, fps, from, to, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(VENV_PYTHON, [path.join(TOOLS, "scenetrack.py"), file,
      "--t", String(t), "--x", String(x), "--y", String(y), "--fps", String(fps || 30),
      "--from", String(from ?? 0), "--to", String(to ?? t)], { stdio: ["ignore", "pipe", "pipe"] });
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
      if (code !== 0) return reject(new Error(`suivi du décor impossible (${code})\n${err.slice(-1500)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`suivi du décor illisible : ${e.message}`)); }
    });
  });
}

// ------------------------------------------------------------- hidden away
//
// « Flouter » (lib/effects-blur.mjs): the clip blurred (or pixelated), kept
// only where a mask says — a followed object's grey mask video, or the
// people's cut-out (its alpha) — widened a little and soft-edged, as a VP9
// WebM with alpha laid over the footage. Made with ffmpeg once.

export function makeBlurLayer(source, mask, target, { mode = "blur", strength = 1, alpha = false, width, height, fps } = {}) {
  const partial = target.replace(/\.webm$/, ".partial.webm");
  const k = Math.max(0.2, Math.min(4, Number(strength) || 1));
  const short = Math.min(width, height);
  const hide = mode === "pixels"
    ? `scale=iw/${Math.max(4, Math.round(short / 40 * k))}:-2:flags=area,scale=${width}:${height}:flags=neighbor`
    : mode === "solid"
      ? `drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill`
      : `gblur=sigma=${Math.round(short / 45 * k)}:steps=3`;
  // The mask, at the frame's size, a little wider than the object and soft.
  const widen = Math.max(4, Math.round(short / 90));
  const maskChain = `${alpha ? "alphaextract," : ""}format=gray,scale=${width}:${height},gblur=sigma=${widen},lut=y='min(255\,val*5)',gblur=sigma=${Math.max(2, Math.round(widen / 2))}`;
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-v", "error", "-y",
      "-i", source,
      ...(alpha ? ["-c:v", "libvpx-vp9"] : []), "-i", mask,
      "-filter_complex", `[0:v]${hide},format=yuv420p[h];[1:v]${maskChain}[m];[h][m]alphamerge,format=yuva420p[o]`,
      "-map", "[o]", "-an", "-r", String(fps || 30),
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "24", "-b:v", "0",
      "-auto-alt-ref", "0", "-g", "1", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1",
      partial,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", reject);
    proc.on("close", async (code) => {
      if (code !== 0) {
        await fsp.rm(partial, { force: true });
        return reject(new Error(`flou impossible (${code})\n${err.slice(-1500)}`));
      }
      await fsp.rename(partial, target);
      resolve();
    });
  });
}

// ------------------------------------------------------------- chosen object
//
// SAM 2.1 (Meta, Apache 2.0) in .venv, model in models/: a click on an object
// gives its mask (sam_worker.py, kept running while the dialog is open), then
// objtrack.py follows it through the clip into a grey video that personmatte
// merges with the person (--mask-video).

const SAM_MODEL = path.join(MODELS, "sam2.1_hiera_small.pt");
let samFound;
export function samStatus() {
  if (samFound === undefined) {
    samFound = spawnSync("test", ["-s", SAM_MODEL]).status === 0
      && spawnSync(VENV_PYTHON, ["-c", "import sam2, torch"], { stdio: "ignore" }).status === 0;
  }
  return { available: samFound };
}

// One worker for the whole studio, started on the first click, stopped after
// a few idle minutes (it holds the model in memory).
let worker = null;
function samWorker() {
  if (worker) return worker;
  const proc = spawn(VENV_PYTHON, [path.join(TOOLS, "sam_worker.py"), "--model", SAM_MODEL],
    { stdio: ["pipe", "pipe", "ignore"] });
  const waiting = new Map();
  let seq = 0;
  let buffer = "";
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  proc.stdout.on("data", (d) => {
    buffer += d;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) { markReady(); continue; }
      const w = waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      msg.ok ? w.resolve(msg) : w.reject(new Error(msg.error || "SAM 2 n'a pas répondu"));
    }
  });
  const stop = () => {
    for (const w of waiting.values()) w.reject(new Error("SAM 2 s'est arrêté"));
    waiting.clear();
    worker = null;
  };
  proc.on("close", stop);
  proc.on("error", stop);
  let idle = null;
  worker = {
    async ask(req) {
      clearTimeout(idle);
      idle = setTimeout(() => proc.kill(), 5 * 60 * 1000);
      await ready;
      const id = ++seq;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        proc.stdin.write(JSON.stringify({ ...req, id }) + "\n");
      });
    },
    kill: () => proc.kill(),
  };
  return worker;
}
process.on("exit", () => { if (worker) worker.kill(); });

// The mask under `points` on one image → a tinted PNG overlay at `out`.
export function objectPreview(image, points, level, out) {
  return samWorker().ask({ image, points, level, out });
}

// Follow the object through `file` → a grey mask video at `target`.
// `boxes` (optional): also write where the object is, frame by frame, in
// source pixels (`size` = the source frame) — for effects that follow it.
export function trackObject(file, target, { t, points, level = 2, fps, boxes, size, onProgress } = {}) {
  const partial = target.replace(/\.mp4$/, ".partial.mp4");
  return new Promise((resolve, reject) => {
    const proc = spawn(VENV_PYTHON, [path.join(TOOLS, "objtrack.py"), file, partial,
      "--t", String(t), "--points", JSON.stringify(points), "--fps", String(fps || 30), "--level", String(level), "--model", SAM_MODEL,
      ...(boxes ? ["--boxes", boxes, "--size", `${size.width}x${size.height}`] : [])],
    { stdio: ["ignore", "pipe", "pipe"] });
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
    proc.on("close", async (code) => {
      if (code !== 0) {
        await fsp.rm(partial, { force: true });
        return reject(new Error(`suivi de l'objet impossible (${code})\n${err.slice(-1500)}`));
      }
      await fsp.rename(partial, target);
      try { resolve(JSON.parse(out.trim().split("\n").pop())); } catch { resolve({}); }
    });
  });
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

// ------------------------------------------------------------- trimming

// Pure: the ffmpeg filter joining `segments` of input 0 end to end. Each piece
// of sound fades in and out over 10 ms, so a cut in the middle of a breath
// does not click.
export function joinFilter(segments, hasAudio) {
  const parts = [];
  const pads = [];
  segments.forEach((sg, i) => {
    const a = sg.start.toFixed(3);
    const b = sg.end.toFixed(3);
    parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS,${SDR_TAGS}[v${i}]`);
    if (hasAudio) {
      const len = Math.max(0.02, sg.end - sg.start);
      parts.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS,` +
        `afade=t=in:d=0.01,afade=t=out:st=${(len - 0.01).toFixed(3)}:d=0.01[a${i}]`);
      pads.push(`[v${i}][a${i}]`);
    } else {
      pads.push(`[v${i}]`);
    }
  });
  parts.push(`${pads.join("")}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[v]${hasAudio ? "[a]" : ""}`);
  return parts.join(";");
}

// Cut [start, start + duration] out of `source` into `target` (H.264 + AAC
// MP4), re-encoded so the cut lands on the exact frame rather than the
// nearest keyframe. Written to a sibling file and renamed when complete.
//
// With `segments` (several [start, end] ranges of the source — the text
// editor's cuts), they are joined end to end instead; `duration` is then their
// total length, for the progress.
export function cutClip(source, target, { start, duration, segments, hasAudio = true, onProgress } = {}) {
  const partial = `${target}.partial.mp4`;
  const input = segments && segments.length > 1
    ? ["-i", source, "-filter_complex", joinFilter(segments, hasAudio), "-map", "[v]", ...(hasAudio ? ["-map", "[a]"] : [])]
    : ["-ss", String(segments ? segments[0].start : start), "-i", source,
      "-t", String(segments ? segments[0].end - segments[0].start : duration),
      "-map", "0:v:0", "-map", "0:a:0?", "-vf", SDR_TAGS];
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-v", "error", "-y",
      ...input,
      "-c:v", "libx264", "-crf", "16", "-preset", "fast", ...SDR(),
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "-progress", "pipe:2", "-nostats",
      partial,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    proc.stderr.on("data", (d) => {
      const text = String(d);
      log += text;
      const m = /out_time_us=(\d+)/.exec(text);
      if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
    });
    proc.on("error", reject);
    proc.on("close", async (code) => {
      if (code !== 0) {
        await fsp.rm(partial, { force: true });
        return reject(new Error(`découpe impossible (${code})\n${log.slice(-1500)}`));
      }
      await fsp.rename(partial, target);
      resolve();
    });
  });
}

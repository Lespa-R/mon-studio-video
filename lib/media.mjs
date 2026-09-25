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

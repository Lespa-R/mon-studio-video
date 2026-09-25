// Media analysis: probe a clip, find the face, cut the person out.
// Thin wrappers around ffprobe/ffmpeg and the two Swift Vision helpers.

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TOOLS = path.join(ROOT, "tools");
export const ASSETS = path.join(ROOT, "assets");

function capture(command, args) {
  const r = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  if (r.error) throw new Error(`${command}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${command} exited ${r.status}\n${r.stderr || ""}`);
  return r.stdout;
}

export function have(binary) {
  return spawnSync("sh", ["-lc", `command -v ${binary}`]).status === 0;
}

export function buildTools() {
  const r = spawnSync(path.join(TOOLS, "build.sh"), [], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tools/build.sh failed:\n${r.stderr || r.stdout}`);
}

export function probe(file) {
  const data = JSON.parse(capture("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,nb_frames:stream_side_data=rotation",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ]));

  const stream = data.streams?.[0];
  if (!stream) throw new Error("no video stream");

  const [n, d] = String(stream.r_frame_rate || "30/1").split("/").map(Number);
  const hasAudio = capture("ffprobe", [
    "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
    "-of", "csv=p=0", file,
  ]).trim().length > 0;

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

// Bake a rotation matrix into the pixels — Vision and the browser would
// otherwise disagree about which way is up. Returns true if it rewrote the file.
export function flatten(file, rotation) {
  if (!rotation) return false;
  const tmp = `${file}.upright.mp4`;
  capture("ffmpeg", [
    "-v", "error", "-i", file,
    "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", tmp, "-y",
  ]);
  spawnSync("mv", [tmp, file]);
  return true;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function detectFace(file, samples = 24) {
  const raw = capture(path.join(TOOLS, "facedet"), [file, String(samples)]);
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")));
  const found = parsed.frames.filter((f) => f && f.chin !== undefined);
  if (!found.length) return null;
  return {
    centreX: Math.round(median(found.map((f) => f.cx))),
    chinMin: Math.min(...found.map((f) => f.chin)),
    chinMax: Math.max(...found.map((f) => f.chin)),
    faceHeight: Math.round(median(found.map((f) => f.h))),
    coverage: Number((found.length / parsed.frames.length).toFixed(2)),
  };
}

// Cut the person out of every frame and encode a VP9 WebM with a real alpha
// channel. onProgress receives a 0..1 estimate.
export function makeMatte(file, info, target, opts = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
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
      target, "-y",
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
}

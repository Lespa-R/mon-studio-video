#!/usr/bin/env python3
"""objtrack — follow an object through a video with SAM 2.1 (Meta, Apache 2.0).

    objtrack.py <video> <out.mp4> --t <seconds> --points '[{"x":0.4,"y":0.6,"l":1}]'
                [--fps 30] [--model models/sam2.1_hiera_small.pt]

The object is the one under the clicked points at time t (x, y in 0..1 of the
frame; l = 1 "this", 0 "not this"). Writes a grey video, one frame per frame
of the input: white where the object is. personmatte reads it with
--mask-video and merges it with (or uses it instead of) the person.

Runs in the studio's .venv (Python 3.12, torch, sam2 from Meta's GitHub).
On Apple silicon it uses the GPU (MPS) in bfloat16 — twice as fast as float32
for the same masks. Long clips go in chunks (memory), each chunk started
from the mask where the previous one ended. Clips above 40 fps are tracked
on every other frame. Progress: "progress 0.42" lines on stderr.
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import warnings

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import torch  # noqa: E402
from sam2.build_sam import build_sam2_video_predictor  # noqa: E402

CHUNK = 150          # frames held in memory at once
MAX_SIDE = 1024      # SAM 2 works at 1024 anyway
CONFIG = "configs/sam2.1/sam2.1_hiera_s.yaml"


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def extract(video, folder):
    """Every decoded frame as a JPEG (no frame dropped or doubled)."""
    scale = (f"scale='if(gt(iw,ih),min({MAX_SIDE},iw),-2)'"
             f":'if(gt(iw,ih),-2,min({MAX_SIDE},ih))'")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vf", scale, "-q:v", "3",
                    "-fps_mode", "passthrough", "-start_number", "0",
                    os.path.join(folder, "%06d.jpg")], check=True)
    return sorted(glob.glob(os.path.join(folder, "*.jpg")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--t", type=float, required=True)
    ap.add_argument("--points", required=True)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--level", type=int, default=2, help="size picked for a single click (0 part … 2 whole)")
    ap.add_argument("--model", required=True)
    ap.add_argument("--boxes", default=None, help="also write where the object is, frame by frame (JSON)")
    ap.add_argument("--size", default=None, help="the source frame, WxH, for --boxes in source pixels")
    a = ap.parse_args()

    points = json.loads(a.points)
    if not points:
        sys.exit("objtrack: no point")

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    predictor = build_sam2_video_predictor(CONFIG, a.model, device=device)
    work = tempfile.mkdtemp(prefix="objtrack-")
    try:
        os.makedirs(os.path.join(work, "all"))
        frames = extract(a.video, os.path.join(work, "all"))
        n = len(frames)
        if not n:
            sys.exit("objtrack: no frame")
        stride = 2 if a.fps > 40 else 1
        sampled = list(range(0, n, stride))           # original frame indexes tracked
        prompt = min(range(len(sampled)), key=lambda k: abs(sampled[k] - round(a.t * a.fps)))

        from PIL import Image
        w, h = Image.open(frames[0]).size

        # The clicked frame's mask, chosen exactly as the dialog showed it
        # (sam_worker.mask_for), seeds the tracking.
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        from sam_worker import CONFIG as IMAGE_CONFIG, mask_for
        image_predictor = SAM2ImagePredictor(build_sam2(IMAGE_CONFIG, a.model, device=device))
        with torch.inference_mode(), torch.autocast(device.type, dtype=torch.bfloat16, enabled=device.type == "mps"):
            image_predictor.set_image(np.array(Image.open(frames[sampled[prompt]]).convert("RGB")))
            first = mask_for(image_predictor, points, a.level)
        del image_predictor

        masks = {}  # index in `sampled` -> bool array (h, w)
        chunks = [list(range(s, min(s + CHUNK, len(sampled)))) for s in range(0, len(sampled), CHUNK)]
        home = next(i for i, c in enumerate(chunks) if prompt in c)
        done = 0

        def run(chunk, seed_frame, seed, reverse_too, reverse_only=False):
            nonlocal done
            folder = os.path.join(work, f"c{chunk[0]}")
            os.makedirs(folder, exist_ok=True)
            for k, idx in enumerate(chunk):
                os.symlink(frames[sampled[idx]], os.path.join(folder, f"{k:06d}.jpg"))
            with torch.inference_mode(), torch.autocast(device.type, dtype=torch.bfloat16, enabled=device.type == "mps"):
                state = predictor.init_state(video_path=folder, offload_video_to_cpu=True)
                local = chunk.index(seed_frame)
                predictor.add_new_mask(state, frame_idx=local, obj_id=1, mask=first if seed is None else seed)
                passes = [True] if reverse_only else ([False, True] if reverse_too else [False])
                for reverse in passes:
                    for fi, _, logits in predictor.propagate_in_video(state, reverse=reverse):
                        key = chunk[fi]
                        if key not in masks:
                            done += 1
                            log(f"progress {done / len(sampled):.3f}")
                        masks[key] = (logits[0, 0] > 0).float().cpu().numpy() > 0.5
                predictor.reset_state(state)
            shutil.rmtree(folder, ignore_errors=True)

        # The chunk with the click, both ways; then outwards, each chunk
        # seeded with the mask at its border.
        run(chunks[home], prompt, None, reverse_too=True)
        for c in chunks[home + 1:]:
            prev = c[0] - 1
            c2 = [prev] + c
            run(c2, prev, masks[prev], reverse_too=False)
        for c in reversed(chunks[:home]):
            nxt = c[-1] + 1
            c2 = c + [nxt]
            run(c2, nxt, masks[nxt], reverse_too=False, reverse_only=True)

        # One mask per original frame, as a grey video.
        enc = subprocess.Popen([
            "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}",
            "-r", str(a.fps), "-i", "-", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p",
            "-g", "30", a.out], stdin=subprocess.PIPE)
        blank = np.zeros((h, w), dtype=np.uint8)
        boxes = {"x": [], "y": [], "w": [], "h": [], "seen": []}
        sw, sh = (int(v) for v in a.size.split("x")) if a.size else (w, h)
        kx, ky = sw / w, sh / h
        for i in range(n):
            m = masks.get(min(i // stride, len(sampled) - 1))
            enc.stdin.write(blank.tobytes() if m is None else (m.astype(np.uint8) * 255).tobytes())
            # Where the object is: the box around its pixels (source px).
            ys, xs = (np.nonzero(m) if m is not None else ((), ()))
            if len(xs) >= 20:
                x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
                boxes["x"].append(round((x0 + x1) / 2 * kx, 1))
                boxes["y"].append(round((y0 + y1) / 2 * ky, 1))
                boxes["w"].append(round((x1 - x0) * kx, 1))
                boxes["h"].append(round((y1 - y0) * ky, 1))
                boxes["seen"].append(1)
            else:
                for key in ("x", "y", "w", "h"):
                    boxes[key].append(boxes[key][-1] if boxes[key] else 0)
                boxes["seen"].append(0)
        enc.stdin.close()
        if enc.wait() != 0:
            sys.exit("objtrack: encoding failed")
        if a.boxes:
            with open(a.boxes, "w") as f:
                json.dump({"start": 0, "step": round(1 / a.fps, 6), "width": sw, "height": sh, **boxes}, f)
        print(json.dumps({"frames": n, "tracked": len(masks), "width": w, "height": h}))
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()

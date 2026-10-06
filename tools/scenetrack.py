#!/usr/bin/env python3
"""scenetrack — follow a point of the scenery while the camera moves.

    scenetrack.py <video> --t 2.5 --x 0.5 --y 0.3 --fps 59.94 [--from 0 --to 22.3]

The point (x, y in 0..1 of the frame) is the spot under the text at time t.
Prints, for every tracked frame between --from and --to, where that spot of
the scenery is (source pixels), how much bigger it looks than at t (zoom),
how far it has turned (degrees), and whether it was seen at all:

    {"start": 0.0, "step": 0.0334, "ref": 60, "width": 1080, "height": 1920,
     "x": [...], "y": [...], "s": [...], "r": [...], "lost": [0, 0, 1, ...]}

How, in two layers:
- frame to frame, corners around the point (Shi-Tomasi) are followed with
  pyramidal Lucas-Kanade, checked forwards and backwards; the point moves
  like them (their median move — a hand or a passer-by does not count).
  Smooth, but tiny errors add up;
- every few frames, and every other frame while the spot is out of sight, it
  is looked for as it looked at t (SIFT keypoints around it, RANSAC): that
  gives its position, size and turn directly. A small difference is eased
  away (no drift); a spot found again after being lost brings the text back.
Things close to the camera move faster than the background, so nothing but
the spot's own surroundings moves the text.

Frames are read straight from ffmpeg (backwards in chunks before t), at most
960 px on the long side and 30 times a second. Runs in the studio's .venv
(OpenCV comes with PySceneDetect).
"""

import argparse
import json
import math
import subprocess
import sys

import cv2
import numpy as np

MAX_SIDE = 960
LK = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def probe(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height:format=duration", "-of", "json", video],
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    s = data["streams"][0]
    return int(s["width"]), int(s["height"]), float(data["format"]["duration"])


class Reader:
    """Grey frames by index, straight from ffmpeg."""

    def __init__(self, video, fps, w, h):
        self.video, self.fps, self.w, self.h = video, fps, w, h

    def range(self, n0, count):
        """Frames n0 … n0 + count - 1 (fewer at the end of the file)."""
        proc = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{max(0, n0 - 0.25) / self.fps:.4f}",
                                 "-i", self.video, "-frames:v", str(count),
                                 "-vf", f"scale={self.w}:{self.h},format=gray", "-f", "rawvideo", "-"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        size = self.w * self.h
        try:
            for _ in range(count):
                buf = proc.stdout.read(size)
                if len(buf) < size:
                    break
                yield np.frombuffer(buf, dtype=np.uint8).reshape(self.h, self.w)
        finally:
            proc.stdout.close()
            proc.kill()
            proc.wait()

    def forward(self, n0, n1, stride):
        """Frames n0, n0 + stride, … up to n1 (included)."""
        for i, img in enumerate(self.range(n0, n1 - n0 + 1)):
            if i % stride == 0:
                yield img

    def backward(self, n0, n1, stride, chunk=90):
        """Frames n1, n1 - stride, … down to n0, read in chunks."""
        end = n1 + 1
        while end > n0:
            start = max(n0, end - chunk)
            got = list(self.range(start, end - start))
            for j in range(len(got) - 1, -1, -1):
                if (n1 - (start + j)) % stride == 0:
                    yield got[j]
            end = start


def corners(img, centre, radius, avoid=None, want=150):
    """Trackable corners near `centre`, widening the search if the spot is
    plain (sky, sand)."""
    pts = None
    for r in (radius, radius * 1.6, radius * 2.6):
        mask = np.zeros_like(img)
        cv2.circle(mask, (int(centre[0]), int(centre[1])), int(r), 255, -1)
        if avoid is not None:
            for p in avoid:
                cv2.circle(mask, (int(p[0]), int(p[1])), 7, 0, -1)
        pts = cv2.goodFeaturesToTrack(img, maxCorners=want, qualityLevel=0.01, minDistance=7, mask=mask, blockSize=7)
        if pts is not None and len(pts) >= 20:
            break
    return pts.reshape(-1, 2) if pts is not None else np.zeros((0, 2), np.float32)


class Landmark:
    """The spot as it looked at t: SIFT keypoints around it."""

    def __init__(self, ref, anchor, radius):
        self.sift = cv2.SIFT_create(nfeatures=3000)
        self.bf = cv2.BFMatcher(cv2.NORM_L2)
        kp, des = self.sift.detectAndCompute(ref, None)
        self.xy, self.des = np.zeros((0, 2), np.float32), None
        self.reproj = 5.0 * max(ref.shape) / 640
        if des is None:
            return
        xy = np.array([k.pt for k in kp], np.float32)
        for r in (radius, radius * 1.6, radius * 2.6):
            near = np.linalg.norm(xy - np.asarray(anchor), axis=1) < r
            if near.sum() >= 60:
                break
        self.xy, self.des = xy[near], des[near]

    def find(self, img):
        """(2×3 similarity from t to img, inliers) or None."""
        if self.des is None or len(self.xy) < 10:
            return None
        kp, des = self.sift.detectAndCompute(img, None)
        if des is None or len(kp) < 10:
            return None
        pairs = self.bf.knnMatch(self.des, des, k=2)
        good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
        if len(good) < 10:
            return None
        src = self.xy[[m.queryIdx for m in good]]
        dst = np.array([kp[m.trainIdx].pt for m in good], np.float32)
        est, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=self.reproj,
                                              maxIters=3000, confidence=0.995)
        if est is None or inl is None or inl.sum() < 10:
            return None
        if not 0.4 <= math.hypot(est[0, 0], est[1, 0]) <= 2.5:
            return None
        return est, int(inl.sum())


def zoom_turn(m):
    return math.hypot(m[0, 0], m[1, 0]), math.atan2(m[1, 0], m[0, 0])


def track(frames, anchor, radius, check_every=4):
    """Follow the spot through `frames` (an iterator, the frame at t first).
    Yields (x, y, zoom, turn, seen) per frame, in working pixels."""
    it = iter(frames)
    try:
        prev = next(it)
    except StopIteration:
        return
    h, w = prev.shape
    mark = Landmark(prev, anchor, radius)
    zoom, turn = 1.0, 0.0
    here = np.array(anchor, np.float64)
    yield here[0], here[1], zoom, turn, True
    pts = corners(prev, anchor, radius)
    seen = True
    for k, img in enumerate(it, start=1):
        moved = False
        if seen and len(pts) >= 6:
            p0 = pts.reshape(-1, 1, 2).astype(np.float32)
            p1, st, _ = cv2.calcOpticalFlowPyrLK(prev, img, p0, None, **LK)
            back, st2, _ = cv2.calcOpticalFlowPyrLK(img, prev, p1, None, **LK)
            ok = (st.ravel() == 1) & (st2.ravel() == 1) & (np.linalg.norm((back - p0).reshape(-1, 2), axis=1) < 1.0)
            a_pts, b_pts = p0.reshape(-1, 2)[ok], p1.reshape(-1, 2)[ok]
            flow = b_pts - a_pts
            near = np.linalg.norm(a_pts - here, axis=1) < radius * zoom
            if near.sum() >= 6:
                m = np.median(flow[near], axis=0)
                good = near & (np.linalg.norm(flow - m, axis=1) < 3)
                if good.sum() >= 5:
                    here = here + np.median(flow[good], axis=0)
                    moved = True
            pts = b_pts[np.linalg.norm(b_pts - here, axis=1) < radius * zoom * 1.3]
        inside = -0.02 * w <= here[0] < 1.02 * w and -0.02 * h <= here[1] < 1.02 * h
        lost = not (moved and inside)
        # While lost, look every other frame (SIFT is the slow part).
        look = (k % check_every == 0) if not lost else (k % 2 == 0)
        found = mark.find(img) if look else None
        if found:
            est, n = found
            fz, ft = zoom_turn(est)
            at = est @ np.array([anchor[0], anchor[1], 1.0])
            if not lost:
                # Ease the drift away, gently, so the text does not jump.
                if np.linalg.norm(at - here) < 0.08 * max(w, h):
                    here = here + 0.35 * (at - here)
                zoom = zoom * (fz / zoom) ** 0.35
                turn = turn + 0.35 * (((ft - turn) + math.pi) % (2 * math.pi) - math.pi)
            elif n >= 15:
                # Found again after being lost.
                here, zoom, turn, moved = at, fz, ft, True
                pts = np.zeros((0, 2), np.float32)
        seen = moved and -0.02 * w <= here[0] < 1.02 * w and -0.02 * h <= here[1] < 1.02 * h
        if seen and len(pts) < 60:
            new = corners(img, here, radius * zoom, avoid=pts, want=150 - len(pts))
            if len(new):
                pts = np.vstack([pts.reshape(-1, 2), new]).astype(np.float32)
        yield here[0], here[1], zoom, turn, seen
        prev = img


def smooth(values, keep, r=2):
    """Centred moving average (no lag) inside each run of seen frames."""
    v = np.asarray(values, dtype=np.float64)
    out = v.copy()
    n = len(v)
    for i in range(n):
        if not keep[i]:
            continue
        a, b = i, i
        while a > max(0, i - r) and keep[a - 1]:
            a -= 1
        while b < min(n - 1, i + r) and keep[b + 1]:
            b += 1
        out[i] = v[a:b + 1].mean()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--t", type=float, required=True)
    ap.add_argument("--x", type=float, required=True)
    ap.add_argument("--y", type=float, required=True)
    ap.add_argument("--fps", type=float, required=True)
    ap.add_argument("--from", dest="start", type=float, default=0.0)
    ap.add_argument("--to", dest="end", type=float, default=None)
    ap.add_argument("--radius", type=float, default=0.18, help="spot size, fraction of the frame's long side")
    a = ap.parse_args()

    src_w, src_h, duration = probe(a.video)
    k = min(1.0, MAX_SIDE / max(src_w, src_h))
    w, h = int(round(src_w * k / 2) * 2), int(round(src_h * k / 2) * 2)
    fps = a.fps
    stride = 2 if fps > 40 else 1
    last = max(0, int(duration * fps) - 1)
    ref_n = min(last, max(0, round(a.t * fps)))
    from_n = min(ref_n, max(0, int(math.floor(a.start * fps))))
    to_n = max(ref_n, min(last, int(math.ceil((a.end if a.end is not None else a.t) * fps))))
    # Sampled frames line up on the reference frame.
    from_n = ref_n - ((ref_n - from_n) // stride) * stride
    to_n = ref_n + ((to_n - ref_n) // stride) * stride

    reader = Reader(a.video, fps, w, h)
    anchor = (a.x * w, a.y * h)
    radius = a.radius * max(w, h)
    total = (to_n - from_n) // stride + 2
    done = [0]

    def counted(gen):
        for img in gen:
            done[0] += 1
            if done[0] % 15 == 0:
                log(f"progress {min(0.99, done[0] / total):.3f}")
            yield img

    fwd = list(track(counted(reader.forward(ref_n, to_n, stride)), anchor, radius))
    bwd = list(track(counted(reader.backward(from_n, ref_n, stride)), anchor, radius))
    rows = list(reversed(bwd[1:])) + fwd
    if not rows:
        sys.exit("scenetrack: no frame")
    ref = max(0, len(bwd) - 1)

    xs, ys, zs, ts, seen = (list(c) for c in zip(*rows))
    ts = np.unwrap(np.asarray(ts))
    keep = [bool(s) for s in seen]
    xs, ys, zs, ts = (smooth(v, keep) for v in (xs, ys, zs, ts))
    # At t the text is exactly where it was put.
    dx, dy = a.x * src_w - xs[ref] / k, a.y * src_h - ys[ref] / k
    print(json.dumps({
        "start": round(from_n / fps, 4), "step": round(stride / fps, 5), "ref": ref,
        "width": src_w, "height": src_h,
        "x": [round(v / k + dx, 1) for v in xs], "y": [round(v / k + dy, 1) for v in ys],
        "s": [round(v / zs[ref], 4) for v in zs], "r": [round(math.degrees(v - ts[ref]), 2) for v in ts],
        "lost": [0 if s else 1 for s in keep],
    }))


if __name__ == "__main__":
    main()

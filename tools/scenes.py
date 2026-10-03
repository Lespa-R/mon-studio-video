#!/usr/bin/env python3
"""scenes — find the shots of a video with PySceneDetect (BSD).

    scenes.py <video> [--sensitivity fine|normal|coarse] [--min 1.0]

Prints {"fps", "duration", "scenes": [{"start", "end"}]} (seconds) on stdout,
and "progress 0.42" lines on stderr. Runs in the studio's own virtualenv
(.venv, Python 3.12): the system Python is too old for scenedetect 0.7.

AdaptiveDetector compares each frame with a rolling average of its
neighbours, so a camera pan or a person walking by (common in drone and
handheld rushes) is not taken for a cut the way a plain threshold would.
"""

import argparse
import json
import sys

from scenedetect import AdaptiveDetector, SceneManager, open_video

# Lower adaptive threshold = more cuts.
SENSITIVITY = {"fine": 2.2, "normal": 3.0, "coarse": 4.5}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--sensitivity", choices=SENSITIVITY, default="normal")
    ap.add_argument("--min", type=float, default=1.0, help="shortest shot, seconds")
    a = ap.parse_args()

    video = open_video(a.video)
    fps = float(video.frame_rate)
    duration = video.duration.seconds if video.duration else 0.0

    manager = SceneManager()
    manager.add_detector(AdaptiveDetector(
        adaptive_threshold=SENSITIVITY[a.sensitivity],
        min_scene_len=max(1, round(a.min * fps)),
    ))

    # Detect in slices, to report progress; each call carries on where the
    # previous one stopped.
    step = max(2.0, duration / 40) if duration else 0
    at = 0.0
    while step and at < duration:
        at = min(duration, at + step)
        manager.detect_scenes(video=video, end_time=at)
        print(f"progress {at / duration:.3f}", file=sys.stderr, flush=True)
    if not step:
        manager.detect_scenes(video=video)

    scenes = [
        {"start": round(s.seconds, 3), "end": round(e.seconds, 3)}
        for s, e in manager.get_scene_list(start_in_scene=True)
    ]
    json.dump({"fps": fps, "duration": round(duration, 3), "scenes": scenes}, sys.stdout)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""sam_worker — instant object masks for the « Objet choisi » dialog.

    sam_worker.py --model models/sam2.1_hiera_small.pt

Stays running while the dialog is open (loading SAM 2 takes a few seconds; a
click then answers in a fraction of one). Reads one JSON request per line on
stdin:

    {"id": 1, "image": "/path/frame.jpg", "points": [{"x": .4, "y": .6, "l": 1}], "level": 2, "out": "/path/mask.png"}

and answers one JSON line on stdout: {"id": 1, "ok": true, "area": 0.12}.
The PNG is the mask as a tinted overlay (transparent elsewhere), drawn over
the frame by the UI. The image embedding is kept for the last image, so more
clicks on the same frame are quick.
"""

import argparse
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from sam2.build_sam import build_sam2  # noqa: E402
from sam2.sam2_image_predictor import SAM2ImagePredictor  # noqa: E402

CONFIG = "configs/sam2.1/sam2.1_hiera_s.yaml"
TINT = (47, 124, 246)


def pick(masks, level):
    """For one click SAM proposes three nested masks: a part (one banana), a
    bigger part, the whole object (the bunch). Its "confidence" favours the
    smallest, which is rarely what goes in front of a text, so the user picks
    the size: 0 part, 1 medium, 2 whole. A "whole" that would cover more than
    half of the image (the background) steps down. objtrack.py seeds the
    tracking with this same choice: what is shown is what is followed."""
    order = sorted(range(len(masks)), key=lambda i: masks[i].sum())
    level = max(0, min(len(order) - 1, int(level)))
    while level > 0 and (masks[order[level]] > 0.5).mean() > 0.5:
        level -= 1
    return masks[order[level]] > 0.5


def mask_for(predictor, points, level=2):
    h, w = predictor._orig_hw[-1]
    pts = np.array([[p["x"] * w, p["y"] * h] for p in points], dtype=np.float32)
    labels = np.array([1 if p.get("l", 1) else 0 for p in points], dtype=np.int32)
    single = len(pts) == 1
    masks, _, _ = predictor.predict(point_coords=pts, point_labels=labels, multimask_output=single)
    return pick(masks, level) if single else masks[0] > 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    a = ap.parse_args()
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    predictor = SAM2ImagePredictor(build_sam2(CONFIG, a.model, device=device))
    current = None
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        try:
            with torch.inference_mode(), torch.autocast(device.type, dtype=torch.bfloat16, enabled=device.type == "mps"):
                if req["image"] != current:
                    image = np.array(Image.open(req["image"]).convert("RGB"))
                    predictor.set_image(image)
                    current = req["image"]
                h, w = predictor._orig_hw[-1]
                mask = mask_for(predictor, req["points"], req.get("level", 2))
            rgba = np.zeros((h, w, 4), dtype=np.uint8)
            rgba[mask] = (*TINT, 120)
            Image.fromarray(rgba, "RGBA").save(req["out"])
            print(json.dumps({"id": req.get("id"), "ok": True, "area": round(float(mask.mean()), 4)}), flush=True)
        except Exception as error:  # noqa: BLE001 — answer, never die
            print(json.dumps({"id": req.get("id"), "ok": False, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()

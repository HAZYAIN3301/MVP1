#!/usr/bin/env python3
"""
Verifiziert die Helligkeits-Extraktion (spiegelt imageProcessing.js):
mittlere Rec.709-Luminanz in kreisförmiger ROI minus Ecken-Hintergrund,
normiert auf Frame 0. Sollte die Soll-Kurve 100/62/31/14/9/6 reproduzieren.
"""
import json, os
import numpy as np
from PIL import Image

BASE = os.path.join(os.path.dirname(__file__), "..", "photos")

def lum(arr):  # arr: (...,3) float
    return 0.2126*arr[...,0] + 0.7152*arr[...,1] + 0.0722*arr[...,2]

def mean_roi(img, roi):
    W, H = img.shape[1], img.shape[0]
    cx, cy = roi["cx"]*W, roi["cy"]*H
    r = roi["r"]*min(W, H)
    ys, xs = np.mgrid[0:H, 0:W]
    mask = (xs-cx)**2 + (ys-cy)**2 <= r*r
    return lum(img.astype(float))[mask].mean()

def bg(img, patch=0.08):
    W, H = img.shape[1], img.shape[0]
    pw, ph = int(W*patch), int(H*patch)
    L = lum(img.astype(float))
    corners = [L[0:ph,0:pw], L[0:ph,W-pw:W], L[H-ph:H,0:pw], L[H-ph:H,W-pw:W]]
    return np.mean([c.mean() for c in corners])

manifest = json.load(open(os.path.join(BASE, "manifest.json")))
roi = manifest["roi"]
raw = []
for f in manifest["frames"]:
    img = np.asarray(Image.open(os.path.join(BASE, f["file"])).convert("RGB"))
    val = max(0.0, mean_roi(img, roi) - bg(img))
    raw.append((f["t"], val))

ref = raw[0][1]
print("Extrahierte Kinetik-Kurve (normiert auf Frame 0):")
for t, v in raw:
    pct = round(v/ref*100, 1)
    print(f"  t={t:4d}s   roh-Luminanz={v:7.2f}   →  {pct:5.1f}%")
print("\nSoll:  100 → 62 → 31 → 14 → 9 → 6")

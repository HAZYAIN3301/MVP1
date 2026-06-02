#!/usr/bin/env python3
"""
Generiert synthetische Dunkelbox-Fotos der Biolumineszenz für den
Integrationstest der Webapp — BEVOR echte Experiment-Fotos existieren.

Jedes Foto zeigt eine zentrale leuchtende Sensor-Lunke (radialer
Blau-Grün-Gradient auf fast-schwarzem Grund) mit abnehmender Helligkeit
entlang eines NaClO-Profils (schneller Einbruch = Oxidationsmittel).

Wenn echte Fotos vorliegen: einfach die PNGs in photos/ ersetzen
(gleiche Dateinamen) — der Rest der App bleibt unverändert.

Aufruf:  python3 tools/generate_test_photos.py
"""
import os
import math

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "photos")
SIZE = 800                      # Bildkante in px
WELL_COLOR = (50, 205, 235)     # blau-grünes BL (~490 nm)
BG_LEVEL = 3                    # Dunkelbox ist nie perfekt schwarz
SIGMA = 95.0                    # Streuung des Leuchtflecks (px)
NOISE = 2.5                     # Sensor-Rauschen (Std)

# Zeitreihe: t (s), normalisierte Soll-Helligkeit (% der Kontrolle), Label
FRAMES = [
    (0,   100, "Kontrolle (vor Zugabe)"),
    (30,   62, "30 Sekunden"),
    (60,   31, "1 Minute"),
    (180,  14, "3 Minuten"),
    (300,   9, "5 Minuten"),
    (900,   6, "15 Minuten"),
]

try:
    import numpy as np
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False

from PIL import Image


def render_numpy(level):
    cx = cy = SIZE / 2.0
    ys, xs = np.mgrid[0:SIZE, 0:SIZE]
    d2 = (xs - cx) ** 2 + (ys - cy) ** 2
    glow = math.exp(0) * np.exp(-d2 / (2 * SIGMA ** 2))   # 0..1 spatial
    f = level / 100.0
    rng = np.random.default_rng(seed=level)               # reproduzierbar
    noise = rng.normal(0, NOISE, (SIZE, SIZE))
    img = np.zeros((SIZE, SIZE, 3), dtype=np.float64)
    for c in range(3):
        img[:, :, c] = BG_LEVEL + f * WELL_COLOR[c] * glow + noise
    img = np.clip(img, 0, 255).astype(np.uint8)
    return Image.fromarray(img, "RGB")


def render_pure_pil(level):
    # Fallback ohne numpy: auf 200px rechnen, dann hochskalieren.
    small = 200
    cx = cy = small / 2.0
    sigma = SIGMA * small / SIZE
    f = level / 100.0
    im = Image.new("RGB", (small, small))
    px = im.load()
    for y in range(small):
        for x in range(small):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            glow = math.exp(-d2 / (2 * sigma ** 2))
            r = min(255, int(BG_LEVEL + f * WELL_COLOR[0] * glow))
            g = min(255, int(BG_LEVEL + f * WELL_COLOR[1] * glow))
            b = min(255, int(BG_LEVEL + f * WELL_COLOR[2] * glow))
            px[x, y] = (r, g, b)
    return im.resize((SIZE, SIZE), Image.BILINEAR)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    render = render_numpy if HAVE_NUMPY else render_pure_pil
    print(f"Generator: {'numpy' if HAVE_NUMPY else 'pure-PIL'}  →  {os.path.abspath(OUT_DIR)}")
    for t, level, label in FRAMES:
        img = render(level)
        fname = f"t{t:03d}.png"
        img.save(os.path.join(OUT_DIR, fname))
        print(f"  {fname:12s}  Soll-Helligkeit {level:3d}%   ({label})")
    print("\nSoll-Kinetik-Kurve (sollte die App nach Extraktion reproduzieren):")
    print("  " + " → ".join(f"{lv}%" for _, lv, _ in FRAMES))


if __name__ == "__main__":
    main()

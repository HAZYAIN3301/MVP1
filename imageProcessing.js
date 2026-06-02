// ============================================================
// imageProcessing.js
// Phase 2: Helligkeit der Biolumineszenz aus echten (oder
// synthetischen) Fotos extrahieren — reines Browser-JS, keine Deps.
//
// WICHTIG: Canvas-Pixel lesen funktioniert NICHT über file://
// (CORS-Tainting). Lokal über einen HTTP-Server starten:
//     cd ~/Documents/bio-referat-app && python3 -m http.server 8080
// ============================================================

/** Lädt ein Bild und liefert ein HTMLImageElement, wenn bereit. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden: " + src));
    img.src = src;
  });
}

/** Relative Luminanz (Rec. 709). Für schwaches blau-grünes BL ausreichend;
 *  bei Bedarf auf (R+G+B)/3 umstellen. */
function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Mittlere Luminanz in einer kreisförmigen ROI.
 * roi: { cx, cy, r } relativ (0..1); r als Anteil von min(Breite, Höhe).
 * Liefert mittlere Luminanz 0..255.
 */
function meanLuminanceInROI(img, roi, ctx) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const cx = roi.cx * W, cy = roi.cy * H;
  const r = roi.r * Math.min(W, H);
  const r2 = r * r;

  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W, Math.ceil(cx + r));
  const y1 = Math.min(H, Math.ceil(cy + r));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;

  const data = ctx.getImageData(x0, y0, w, h).data;
  let sum = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x0 + x) - cx, dy = (y0 + y) - cy;
      if (dx * dx + dy * dy > r2) continue; // außerhalb des Kreises
      const i = (y * w + x) * 4;
      sum += luminance(data[i], data[i + 1], data[i + 2]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Hintergrund-Luminanz aus den vier Bildecken schätzen (Dunkelbox ist
 * nie perfekt schwarz). Wird von der ROI-Helligkeit abgezogen.
 */
function estimateBackground(img, ctx, patch = 0.08) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const pw = Math.max(1, Math.floor(W * patch));
  const ph = Math.max(1, Math.floor(H * patch));
  const corners = [
    [0, 0], [W - pw, 0], [0, H - ph], [W - pw, H - ph]
  ];
  let sum = 0, count = 0;
  for (const [cx, cy] of corners) {
    const data = ctx.getImageData(cx, cy, pw, ph).data;
    for (let i = 0; i < data.length; i += 4) {
      sum += luminance(data[i], data[i + 1], data[i + 2]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Manifest laden, alle Frames messen, auf den ersten Frame (Kontrolle)
 * normieren. Liefert [{ t, brightness (% der Kontrolle), label, file, raw }].
 */
async function buildMeasurementsFromManifest(manifest, basePath = "photos/") {
  const roi = manifest.roi;
  const subtractBg = manifest.subtractBackground !== false;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const raw = [];
  for (const frame of manifest.frames) {
    const img = await loadImage(basePath + frame.file);
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    let lum = meanLuminanceInROI(img, roi, ctx);
    if (subtractBg) {
      const bg = estimateBackground(img, ctx);
      lum = Math.max(0, lum - bg);
    }
    raw.push({ t: frame.t, lum, label: frame.label, file: frame.file });
  }

  const ref = raw.length ? raw[0].lum : 0;
  return raw.map(r => ({
    t: r.t,
    brightness: ref > 0 ? Math.round((r.lum / ref) * 1000) / 10 : 0,
    label: r.label,
    file: r.file,
    raw: Math.round(r.lum * 10) / 10
  }));
}

/**
 * Versucht, Messdaten aus echten Fotos zu laden.
 * Liefert { measurements, manifest } oder null (dann nutzt app.js den Fallback).
 */
async function tryLoadPhotoMeasurements(manifestUrl = "photos/manifest.json") {
  try {
    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const manifest = await res.json();
    if (!manifest.frames || !manifest.frames.length) return null;
    const measurements = await buildMeasurementsFromManifest(manifest);
    return { measurements, manifest };
  } catch (err) {
    console.warn("Foto-Modus nicht verfügbar, nutze Fallback-Daten:", err.message);
    return null;
  }
}

// ============================================================
// imageProcessing.js
// Helligkeit der Biolumineszenz aus Fotos extrahieren —
// reines Browser-JS, keine Deps.
//
// Zwei Quellen:
//   A) gebackene Fotos aus photos/manifest.json (Demo)
//   B) vom Nutzer hochgeladene Fotos (File-Objekte) — mit
//      automatischer Zeiterkennung und automatischer ROI-Suche.
//
// Canvas-Pixel lesen geht NICHT über file:// für photos/ (CORS).
// Hochgeladene Dateien (blob:) sind immer lesbar — auch offline.
// ============================================================

/** Lädt ein Bild von einer URL. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden: " + src));
    img.src = src;
  });
}

/** Lädt ein Bild aus einem File-Objekt (Upload). Liefert {img, url}. */
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild nicht lesbar: " + file.name)); };
    img.src = url;
  });
}

/** Relative Luminanz (Rec. 709). */
function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mittlere Luminanz in kreisförmiger ROI. roi: {cx,cy,r} relativ (0..1). */
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
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * w + x) * 4;
      sum += luminance(data[i], data[i + 1], data[i + 2]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/** Hintergrund-Luminanz aus den vier Bildecken. */
function estimateBackground(img, ctx, patch = 0.08) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const pw = Math.max(1, Math.floor(W * patch));
  const ph = Math.max(1, Math.floor(H * patch));
  const corners = [[0, 0], [W - pw, 0], [0, H - ph], [W - pw, H - ph]];
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
 * Findet die leuchtende Lunke automatisch: hellste Region per Schwellenwert,
 * dann luminanz-gewichteter Schwerpunkt + Radius aus der Streuung.
 * Arbeitet auf einer verkleinerten Kopie (schnell). Liefert {cx,cy,r} relativ.
 */
function detectROI(img, ctx) {
  const maxW = 320;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  ctx.canvas.width = w; ctx.canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const L = new Float32Array(w * h);
  let maxL = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = luminance(data[i], data[i + 1], data[i + 2]);
    L[p] = l; if (l > maxL) maxL = l;
  }
  const thr = Math.max(8, maxL * 0.35);

  let sx = 0, sy = 0, sw = 0, cnt = 0;
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    const l = L[p];
    if (l >= thr) { sx += x * l; sy += y * l; sw += l; cnt++; }
  }
  if (sw <= 0 || cnt < 3) return { cx: 0.5, cy: 0.5, r: 0.18 };

  const cx = sx / sw, cy = sy / sw;
  let sd = 0;
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    if (L[p] >= thr) { const dx = x - cx, dy = y - cy; sd += (dx * dx + dy * dy) * L[p]; }
  }
  const sigma = Math.sqrt(sd / sw);
  const minDim = Math.min(w, h);
  const rRel = Math.min(0.30, Math.max(0.08, (2.0 * sigma) / minDim));
  return { cx: cx / w, cy: cy / h, r: rRel };
}

/** Manifest → Messdaten (gebackene Demo-Fotos). */
async function buildMeasurementsFromManifest(manifest, basePath = "photos/") {
  const roi = manifest.roi;
  const subtractBg = manifest.subtractBackground !== false;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const raw = [];
  for (const frame of manifest.frames) {
    const img = await loadImage(basePath + frame.file);
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    let lum = meanLuminanceInROI(img, roi, ctx);
    if (subtractBg) lum = Math.max(0, lum - estimateBackground(img, ctx));
    raw.push({ t: frame.t, lum, label: frame.label, src: basePath + frame.file });
  }
  const ref = raw.length ? raw[0].lum : 0;
  return raw.map(r => ({
    t: r.t,
    brightness: ref > 0 ? Math.round((r.lum / ref) * 1000) / 10 : 0,
    label: r.label, src: r.src
  }));
}

/** Lädt Demo-Messdaten, oder null (dann Fallback in app.js). */
async function tryLoadPhotoMeasurements(manifestUrl = "photos/manifest.json") {
  try {
    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const manifest = await res.json();
    if (!manifest.frames || !manifest.frames.length) return null;
    const measurements = await buildMeasurementsFromManifest(manifest);
    return { measurements, manifest };
  } catch (err) {
    console.warn("Foto-Modus nicht verfügbar, nutze Fallback:", err.message);
    return null;
  }
}

/**
 * Hochgeladene Fotos → Messdaten.
 * - Sortiert nach Aufnahmezeit (lastModified).
 * - Zeiten t automatisch aus den Zeitstempeln (Sekunden ab erstem Foto).
 *   Wenn unbrauchbar → Standard-Intervalle 0/30/60/180/300/900 s.
 * - ROI automatisch auf dem ersten (hellsten) Foto erkannt, für alle gleich.
 * Liefert { measurements, roi, timeSource }.
 */
async function buildMeasurementsFromFiles(files) {
  const list = [...files].filter(f => f.type && f.type.startsWith("image/"));
  if (list.length < 2) throw new Error("Bitte mindestens 2 Fotos auswählen.");
  list.sort((a, b) => a.lastModified - b.lastModified);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const loaded = [];
  for (const f of list) loaded.push({ f, ...(await loadImageFromFile(f)) });

  // Zeiten aus Zeitstempeln
  const t0 = list[0].lastModified;
  let times = list.map(f => Math.round((f.lastModified - t0) / 1000));
  const monotonic = times.every((t, i) => i === 0 || t > times[i - 1]) && times[times.length - 1] > 0;
  let timeSource = "Aufnahme-Zeitstempel";
  if (!monotonic) {
    const STD = [0, 30, 60, 180, 300, 900];
    times = loaded.map((_, i) => i < STD.length ? STD[i] : STD[STD.length - 1] + (i - STD.length + 1) * 300);
    timeSource = "Standard-Intervalle (Zeitstempel unbrauchbar)";
  }

  // ROI auf dem ersten Frame erkennen, für alle anwenden
  const roi = detectROI(loaded[0].img, ctx);

  const raw = [];
  for (let i = 0; i < loaded.length; i++) {
    const { img, url } = loaded[i];
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    let lum = meanLuminanceInROI(img, roi, ctx);
    lum = Math.max(0, lum - estimateBackground(img, ctx));
    raw.push({ t: times[i], lum, src: url, label: times[i] + " s" });
  }
  const ref = raw[0].lum || 1;
  const measurements = raw.map(r => ({
    t: r.t,
    brightness: ref > 0 ? Math.round((r.lum / ref) * 1000) / 10 : 0,
    label: r.label, src: r.src
  }));
  return { measurements, roi, timeSource };
}

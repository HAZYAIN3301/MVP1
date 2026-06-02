// ============================================================
// imageProcessing.js
// Helligkeit der Biolumineszenz aus Fotos extrahieren — reines
// Browser-JS. Funktioniert auf iPad, Android, Windows, macOS.
//
// Upload-Pfad:
//   - versucht zuerst, das Bild nativ zu dekodieren (JPEG/PNG/WebP;
//     HEIC nur auf Safari/iOS nativ möglich);
//   - schlägt das fehl und ist es HEIC/HEIF, wird es per heic2any
//     (CDN) nach JPEG konvertiert und erneut versucht;
//   - automatische Zeiterkennung (Datei-Zeitstempel) und ROI-Suche.
// ============================================================

/** Lädt ein Bild von einer URL (gebackene Demo-Fotos). */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden: " + src));
    img.src = src;
  });
}

/** Versucht, einen Blob/File zu dekodieren. Liefert {img, url}. */
function decodeBlob(blob, name) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild nicht lesbar: " + (name || ""))); };
    img.src = url;
  });
}

/** Lädt ein Bild aus einem File — mit HEIC-Fallback. Liefert {img, url}. */
async function loadImageFromFile(file) {
  const isHeic = /heic|heif/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || "");
  // 1) nativer Versuch (Safari/iOS schaffen auch HEIC)
  try {
    return await decodeBlob(file, file.name);
  } catch (e) {
    // 2) HEIC → konvertieren und erneut versuchen
    if (isHeic && typeof window !== "undefined" && window.heic2any) {
      let out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
      if (Array.isArray(out)) out = out[0];
      return await decodeBlob(out, file.name);
    }
    throw isHeic
      ? new Error("HEIC nicht unterstützt: " + file.name + " (Konverter nicht geladen)")
      : e;
  }
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

/** Findet die leuchtende Lunke automatisch (Schwellenwert + Schwerpunkt). */
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
 * Hochgeladene Fotos → Messdaten. Robust: einzelne unlesbare Dateien
 * werden übersprungen, nicht der ganze Vorgang abgebrochen.
 * Liefert { measurements, roi, timeSource, skipped }.
 */
async function buildMeasurementsFromFiles(files) {
  const list = [...files].filter(f =>
    (f.type && f.type.startsWith("image/")) ||
    /\.(heic|heif|jpe?g|png|webp|gif|bmp)$/i.test(f.name || "")
  );
  if (list.length < 2) throw new Error("Bitte mindestens 2 Fotos auswählen.");
  list.sort((a, b) => a.lastModified - b.lastModified);

  const t0 = list[0].lastModified;
  const initialTimes = list.map(f => Math.round((f.lastModified - t0) / 1000));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const good = [], skipped = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const { img, url } = await loadImageFromFile(list[i]);
      good.push({ img, url, t: initialTimes[i] });
    } catch (e) {
      skipped.push(list[i].name || "Datei");
      console.warn(e.message);
    }
  }
  if (good.length < 2) {
    throw new Error(
      `Nur ${good.length} von ${list.length} Bildern lesbar.` +
      (skipped.length ? " Problem mit: " + skipped.join(", ") : "")
    );
  }

  // Zeiten prüfen / ggf. Standard-Intervalle
  let gt = good.map(g => g.t);
  let timeSource = "Aufnahme-Zeitstempel";
  const monotonic = gt.every((t, i) => i === 0 || t > gt[i - 1]) && gt[gt.length - 1] > 0;
  if (!monotonic) {
    const STD = [0, 30, 60, 180, 300, 900];
    good.forEach((g, i) => { g.t = i < STD.length ? STD[i] : STD[STD.length - 1] + (i - STD.length + 1) * 300; });
    timeSource = "Standard-Intervalle (Zeitstempel unbrauchbar)";
  } else {
    const z = good[0].t;
    good.forEach(g => { g.t -= z; });
  }

  const roi = detectROI(good[0].img, ctx);
  const raw = [];
  for (const g of good) {
    canvas.width = g.img.naturalWidth; canvas.height = g.img.naturalHeight;
    ctx.drawImage(g.img, 0, 0);
    let lum = meanLuminanceInROI(g.img, roi, ctx);
    lum = Math.max(0, lum - estimateBackground(g.img, ctx));
    raw.push({ t: g.t, lum, src: g.url, label: g.t + " s" });
  }
  const ref = raw[0].lum || 1;
  const measurements = raw.map(r => ({
    t: r.t,
    brightness: ref > 0 ? Math.round((r.lum / ref) * 1000) / 10 : 0,
    label: r.label, src: r.src
  }));
  return { measurements, roi, timeSource, skipped };
}

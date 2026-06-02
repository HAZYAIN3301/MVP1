// ============================================================
// Toxikologie-Detektiv — Logik
//
// Zwei Wege zum Ergebnis:
//   1) "Analyse starten (Demo)" → gebackene Fotos aus photos/.
//   2) "Eigene Fotos hochladen"  → beliebige Fotos vom Gerät;
//      Zeiten und ROI werden automatisch erkannt. Kein Code nötig.
// ============================================================

// Fallback-Messwerte (NaClO), falls weder Fotos noch Upload verfügbar.
const SYNTHETIC_DATA = [
  { t: 0,   brightness: 100, label: "Kontrolle (vor Zugabe)" },
  { t: 30,  brightness: 62,  label: "30 Sekunden" },
  { t: 60,  brightness: 31,  label: "1 Minute" },
  { t: 180, brightness: 14,  label: "3 Minuten" },
  { t: 300, brightness: 9,   label: "5 Minuten" },
  { t: 900, brightness: 6,   label: "15 Minuten" }
];

const referenceProfiles = {
  oxidant: {
    label: "Oxidationsmittel (NaClO)",
    color: "rgba(255, 107, 107, 0.5)",
    data: [
      { t: 0, brightness: 100 }, { t: 30, brightness: 60 },
      { t: 60, brightness: 30 }, { t: 180, brightness: 15 },
      { t: 300, brightness: 10 }, { t: 900, brightness: 8 }
    ]
  },
  metal: {
    label: "Schwermetall (Pb²⁺)",
    color: "rgba(107, 158, 255, 0.5)",
    data: [
      { t: 0, brightness: 100 }, { t: 30, brightness: 95 },
      { t: 60, brightness: 88 }, { t: 180, brightness: 70 },
      { t: 300, brightness: 55 }, { t: 900, brightness: 35 }
    ]
  },
  organic: {
    label: "Organischer Schadstoff (3,5-DCP)",
    color: "rgba(107, 255, 142, 0.5)",
    data: [
      { t: 0, brightness: 100 }, { t: 30, brightness: 92 },
      { t: 60, brightness: 80 }, { t: 180, brightness: 60 },
      { t: 300, brightness: 42 }, { t: 900, brightness: 22 }
    ]
  }
};

const classificationLabels = {
  oxidant: {
    name: "Oxidationsmittel", example: "z.B. Natriumhypochlorit (NaClO)", cssClass: "oxidant",
    explanation: "Die Biolumineszenz bricht innerhalb der ersten Minute fast vollständig zusammen. Oxidationsmittel greifen die Zellmembran direkt an — die Bakterien sterben sofort, ohne Reparaturzeit."
  },
  metal: {
    name: "Schwermetall", example: "z.B. Blei(II) (Pb²⁺)", cssClass: "metal",
    explanation: "Langsamer, kontinuierlicher Rückgang über 15+ Minuten. Schwermetalle blockieren Enzyme, die für die Biolumineszenz-Reaktion nötig sind — der Effekt baut sich graduell auf."
  },
  organic: {
    name: "Organischer Schadstoff", example: "z.B. 3,5-Dichlorphenol (3,5-DCP)", cssClass: "organic",
    explanation: "Mittlere Kinetik mit Verzögerung. Organische Substanzen müssen erst in die Zellen eindringen und Stoffwechselwege stören, bevor die Biolumineszenz spürbar abnimmt."
  }
};

let chart;
let measurements = [...SYNTHETIC_DATA];
let dataSource = "fallback";   // "photos" | "upload" | "fallback"
let sourceNote = "";
let measurementIndex = 0;
let measurementTimer = null;
let objectUrls = [];           // zum Aufräumen nach Upload

function initChart() {
  const ctx = document.getElementById('kineticChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Live-Messung', data: [],
          borderColor: '#4a9eff', backgroundColor: 'rgba(74, 158, 255, 0.15)',
          tension: 0.3, pointRadius: 7, pointBackgroundColor: '#4a9eff',
          pointBorderColor: '#fff', pointBorderWidth: 2, borderWidth: 3, fill: true, order: 1
        },
        ...Object.values(referenceProfiles).map(prof => ({
          label: 'Ref: ' + prof.label,
          data: prof.data.map(p => ({ x: p.t, y: p.brightness })),
          borderColor: prof.color, borderDash: [6, 4], pointRadius: 0,
          borderWidth: 1.5, fill: false, tension: 0.3, order: 2
        }))
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Zeit nach Toxikantenzugabe (s)', color: '#a8a8b5' },
          ticks: { color: '#888' }, grid: { color: '#2a2a36' }
        },
        y: {
          min: 0, max: 110,
          title: { display: true, text: 'Biolumineszenz (% der Kontrolle)', color: '#a8a8b5' },
          ticks: { color: '#888' }, grid: { color: '#2a2a36' }
        }
      },
      plugins: {
        legend: { labels: { color: '#c8c8d0', boxWidth: 20, padding: 12, font: { size: 11 } } },
        title: {
          display: true, text: 'Kinetisches Profil — Biolumineszenz über Zeit',
          color: '#e8e8ec', font: { size: 14, weight: 'normal' }
        }
      }
    }
  });
}

function setStep(html) { document.getElementById('step-indicator').innerHTML = html; }

function addThumb(m) {
  if (!m.src) return;
  const thumbs = document.getElementById('thumbs');
  const div = document.createElement('div');
  div.className = 'thumb';
  div.innerHTML = `<img src="${m.src}" alt="${m.label}"><span>${m.brightness}%</span>`;
  thumbs.appendChild(div);
  requestAnimationFrame(() => div.classList.add('show'));
}

function addNextMeasurement() {
  if (measurementIndex >= measurements.length) {
    setTimeout(classifyAndShow, 800);
    return;
  }
  const point = measurements[measurementIndex];
  chart.data.datasets[0].data.push({ x: point.t, y: point.brightness });
  chart.update();
  addThumb(point);
  setStep(
    `<strong>Messung ${measurementIndex + 1}/${measurements.length}</strong><br>` +
    `${point.label} → ${point.brightness}% Biolumineszenz`
  );
  measurementIndex++;
  measurementTimer = setTimeout(addNextMeasurement, 2500);
}

// Referenzkurve linear an beliebigem Zeitpunkt t interpolieren.
function interpAt(refData, t) {
  if (t <= refData[0].t) return refData[0].brightness;
  for (let i = 1; i < refData.length; i++) {
    if (t <= refData[i].t) {
      const a = refData[i - 1], b = refData[i];
      const f = (t - a.t) / (b.t - a.t);
      return a.brightness + f * (b.brightness - a.brightness);
    }
  }
  return refData[refData.length - 1].brightness;
}

// Mittlere euklidische Distanz pro Zeitpunkt (robust gegen beliebige t).
function profileDistance(measured, reference) {
  let sumSquares = 0, n = 0;
  for (const m of measured) {
    const r = interpAt(reference, m.t);
    const diff = m.brightness - r;
    sumSquares += diff * diff; n++;
  }
  return n ? Math.sqrt(sumSquares / n) : Infinity;
}

function classifyAndShow() {
  const distances = {};
  for (const [key, profile] of Object.entries(referenceProfiles)) {
    distances[key] = profileDistance(measurements, profile.data);
  }
  const sorted = Object.entries(distances).sort((a, b) => a[1] - b[1]);
  const best = sorted[0][0];
  const result = classificationLabels[best];

  setStep('✓ <strong>Analyse abgeschlossen</strong>');

  const classification = document.getElementById('classification');
  classification.className = result.cssClass;
  classification.innerHTML =
    `${result.name}<br><span style="font-size: 0.85em; font-weight: 400; opacity: 0.85;">${result.example}</span>`;
  document.getElementById('explanation').textContent = result.explanation;

  const reasoning = sorted.map(([key, dist]) =>
    `${classificationLabels[key].name}: Abstand = ${dist.toFixed(1)}`
  ).join(' · ');
  const sourceTxt = {
    photos: "Datenquelle: Demo-Fotos.",
    upload: "Datenquelle: hochgeladene Fotos. " + sourceNote,
    fallback: "Datenquelle: Demo-Werte (keine Fotos geladen)."
  }[dataSource];
  document.getElementById('reasoning').textContent =
    `Vergleich der gemessenen Kurve mit drei Referenz-Profilen (mittlere euklidische Distanz pro Zeitpunkt, interpoliert). ${reasoning}. Kleinste Distanz = beste Übereinstimmung. ${sourceTxt}`;

  document.getElementById('result').classList.remove('hidden');
}

function beginUI() {
  if (measurementTimer) clearTimeout(measurementTimer);
  measurementIndex = 0;
  chart.data.datasets[0].data = [];
  chart.update();
  document.getElementById('thumbs').innerHTML = '';
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('result').classList.add('hidden');
  document.getElementById('status').classList.remove('hidden');
}

// Weg 1: Demo-Fotos
async function startDemo() {
  beginUI();
  setStep('⏳ Lade Demo-Fotos …');
  const loaded = await tryLoadPhotoMeasurements();
  if (loaded && loaded.measurements.length) {
    measurements = loaded.measurements; dataSource = "photos"; sourceNote = "";
    const badge = loaded.manifest.synthetic ? 'Synthetische Testdaten' : 'Demo-Fotos';
    setStep(`📷 ${loaded.measurements.length} Fotos geladen …<br><span class="source-badge">${badge}</span>`);
  } else {
    measurements = [...SYNTHETIC_DATA]; dataSource = "fallback"; sourceNote = "";
    setStep('Demo-Modus (keine Fotos) …');
  }
  setTimeout(addNextMeasurement, 1000);
}

// Weg 2: eigene Fotos
async function startUpload(files) {
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls = [];
  beginUI();
  setStep('⏳ Verarbeite hochgeladene Fotos …');
  try {
    const { measurements: ms, roi, timeSource } = await buildMeasurementsFromFiles(files);
    measurements = ms;
    objectUrls = ms.map(m => m.src);
    dataSource = "upload";
    sourceNote = `Zeiten aus: ${timeSource}. Lunke automatisch erkannt (x=${(roi.cx * 100).toFixed(0)}%, y=${(roi.cy * 100).toFixed(0)}%).`;
    setStep(
      `📷 ${ms.length} Fotos verarbeitet …<br>` +
      `<span class="source-badge">Zeiten: ${timeSource}</span>`
    );
    setTimeout(addNextMeasurement, 1000);
  } catch (err) {
    setStep('⚠️ ' + err.message);
    document.getElementById('intro').classList.remove('hidden');
    document.getElementById('status').classList.add('hidden');
  }
}

function reset() {
  if (measurementTimer) clearTimeout(measurementTimer);
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls = [];
  measurementIndex = 0;
  chart.data.datasets[0].data = [];
  chart.update();
  document.getElementById('thumbs').innerHTML = '';
  document.getElementById('intro').classList.remove('hidden');
  document.getElementById('status').classList.add('hidden');
  document.getElementById('result').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

document.getElementById('start-btn').addEventListener('click', startDemo);
document.getElementById('upload-btn').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length) startUpload(e.target.files);
});
document.getElementById('reset-btn').addEventListener('click', reset);

initChart();

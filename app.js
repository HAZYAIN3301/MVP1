// ============================================================
// Toxikologie-Detektiv — Logik
// Klassen-Aufgabe für das Bio-Referat 18.06.2026
//
// Datenquelle:
//   1) Versucht echte/synthetische Fotos aus photos/manifest.json
//      via imageProcessing.js zu laden (Canvas → Helligkeit).
//   2) Fällt auf SYNTHETIC_DATA zurück, wenn keine Fotos verfügbar
//      sind (z.B. beim Öffnen über file:// ohne HTTP-Server).
// ============================================================

// Fallback-Messwerte (NaClO-Profil), falls Foto-Modus nicht läuft.
const SYNTHETIC_DATA = [
  { t: 0,   brightness: 100, label: "Kontrolle (vor Zugabe)" },
  { t: 30,  brightness: 62,  label: "30 Sekunden" },
  { t: 60,  brightness: 31,  label: "1 Minute" },
  { t: 180, brightness: 14,  label: "3 Minuten" },
  { t: 300, brightness: 9,   label: "5 Minuten" },
  { t: 900, brightness: 6,   label: "15 Minuten" }
];

// Referenz-Profile für drei Toxikantenklassen (Helligkeit vs Zeit)
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
    name: "Oxidationsmittel",
    example: "z.B. Natriumhypochlorit (NaClO)",
    cssClass: "oxidant",
    explanation: "Die Biolumineszenz bricht innerhalb der ersten Minute fast vollständig zusammen. Oxidationsmittel greifen die Zellmembran direkt an — die Bakterien sterben sofort, ohne Reparaturzeit."
  },
  metal: {
    name: "Schwermetall",
    example: "z.B. Blei(II) (Pb²⁺)",
    cssClass: "metal",
    explanation: "Langsamer, kontinuierlicher Rückgang über 15+ Minuten. Schwermetalle blockieren Enzyme, die für die Biolumineszenz-Reaktion nötig sind — der Effekt baut sich graduell auf."
  },
  organic: {
    name: "Organischer Schadstoff",
    example: "z.B. 3,5-Dichlorphenol (3,5-DCP)",
    cssClass: "organic",
    explanation: "Mittlere Kinetik mit Verzögerung. Organische Substanzen müssen erst in die Zellen eindringen und Stoffwechselwege stören, bevor die Biolumineszenz spürbar abnimmt."
  }
};

let chart;
let measurements = [...SYNTHETIC_DATA];  // wird beim Start ggf. ersetzt
let dataSource = "fallback";             // "photos" | "fallback"
let measurementIndex = 0;
let measurementTimer = null;

function initChart() {
  const ctx = document.getElementById('kineticChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Live-Messung',
          data: [],
          borderColor: '#4a9eff',
          backgroundColor: 'rgba(74, 158, 255, 0.15)',
          tension: 0.3,
          pointRadius: 7,
          pointBackgroundColor: '#4a9eff',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          borderWidth: 3,
          fill: true,
          order: 1
        },
        ...Object.values(referenceProfiles).map(prof => ({
          label: 'Ref: ' + prof.label,
          data: prof.data.map(p => ({ x: p.t, y: p.brightness })),
          borderColor: prof.color,
          borderDash: [6, 4],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false,
          tension: 0.3,
          order: 2
        }))
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Zeit nach Toxikantenzugabe (s)', color: '#a8a8b5' },
          ticks: { color: '#888' },
          grid: { color: '#2a2a36' }
        },
        y: {
          min: 0,
          max: 110,
          title: { display: true, text: 'Biolumineszenz (% der Kontrolle)', color: '#a8a8b5' },
          ticks: { color: '#888' },
          grid: { color: '#2a2a36' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#c8c8d0', boxWidth: 20, padding: 12, font: { size: 11 } }
        },
        title: {
          display: true,
          text: 'Kinetisches Profil — Biolumineszenz über Zeit',
          color: '#e8e8ec',
          font: { size: 14, weight: 'normal' }
        }
      }
    }
  });
}

function setStep(html) {
  document.getElementById('step-indicator').innerHTML = html;
}

function addThumb(m) {
  if (!m.file) return;  // im Fallback-Modus keine Bilder
  const thumbs = document.getElementById('thumbs');
  const div = document.createElement('div');
  div.className = 'thumb';
  div.innerHTML = `<img src="photos/${m.file}" alt="${m.label}"><span>${m.brightness}%</span>`;
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

// Euklidische Distanz, ausgerichtet nach Zeitpunkt t (robust gegen Reihenfolge).
function profileDistance(measured, reference) {
  let sumSquares = 0, n = 0;
  for (const m of measured) {
    const ref = reference.find(r => r.t === m.t);
    if (!ref) continue;
    const diff = m.brightness - ref.brightness;
    sumSquares += diff * diff;
    n++;
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
  document.getElementById('reasoning').textContent =
    `Die gemessene Kurve wurde mit drei Referenz-Profilen verglichen (mittlere euklidische Distanz pro Zeitpunkt). ${reasoning}. Kleinste Distanz = beste Übereinstimmung. ` +
    (dataSource === "photos"
      ? "Datenquelle: Helligkeit aus den Experiment-Fotos extrahiert."
      : "Datenquelle: Demo-Werte (keine Fotos geladen — App über HTTP-Server starten).");

  document.getElementById('result').classList.remove('hidden');
}

async function startAnalysis() {
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('status').classList.remove('hidden');
  setStep('⏳ Lade Experiment-Fotos …');

  // Versuche, echte/synthetische Foto-Messwerte zu laden.
  const loaded = await tryLoadPhotoMeasurements();
  if (loaded && loaded.measurements.length) {
    measurements = loaded.measurements;
    dataSource = "photos";
    const badge = loaded.manifest.synthetic
      ? 'Synthetische Testdaten' : 'Echte Experiment-Fotos';
    setStep(`📷 ${loaded.measurements.length} Fotos geladen — Analyse startet …<br><span class="source-badge">${badge}</span>`);
  } else {
    measurements = [...SYNTHETIC_DATA];
    dataSource = "fallback";
    setStep('Demo-Modus (keine Fotos) — Analyse startet …');
  }

  setTimeout(addNextMeasurement, 1000);
}

function reset() {
  if (measurementTimer) clearTimeout(measurementTimer);
  measurementIndex = 0;
  chart.data.datasets[0].data = [];
  chart.update();
  document.getElementById('thumbs').innerHTML = '';
  document.getElementById('intro').classList.remove('hidden');
  document.getElementById('status').classList.add('hidden');
  document.getElementById('result').classList.add('hidden');
  document.getElementById('start-btn').disabled = false;
}

document.getElementById('start-btn').addEventListener('click', startAnalysis);
document.getElementById('reset-btn').addEventListener('click', reset);

initChart();

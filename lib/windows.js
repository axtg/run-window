const SLOT_MS = 15 * 60 * 1000;
const EPSILON = 1e-9;

// Scoring constants (design calls, tunable). Lower scores are better.
const SCORING = {
  wind: { comfortableSpeed: 12, speedWeight: 1.0, comfortableGust: 30, gustWeight: 0.5 },
  temperature: { min: 6, max: 16, weight: 1.0 },
  rain: { probDivisor: 20 },
  fallbackRain: { probDivisor: 2, precipWeight: 20 }
};

const DURATIONS = Array.from({ length: 12 }, (_, i) => String((i + 1) * 15));
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function windAndTempScore({ windSpeed, gust, apparentTemp }) {
  const { wind, temperature } = SCORING;
  const windScore =
    Math.max(0, windSpeed - wind.comfortableSpeed) * wind.speedWeight +
    Math.max(0, gust - wind.comfortableGust) * wind.gustWeight;
  const tempDistance = Math.max(0, temperature.min - apparentTemp, apparentTemp - temperature.max);
  return windScore + tempDistance * temperature.weight;
}

function scoreSlot(values) {
  return windAndTempScore(values) + values.precipProb / SCORING.rain.probDivisor;
}

function fallbackScoreSlot(values) {
  const { probDivisor, precipWeight } = SCORING.fallbackRain;
  return windAndTempScore(values) + values.precipProb / probDivisor + values.precip * precipWeight;
}

function cardinal(degrees) {
  const normalised = ((degrees % 360) + 360) % 360;
  return CARDINALS[Math.floor((normalised + 22.5) / 45) % 8];
}

const round = (value, decimals = 0) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const mean = numbers => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;

// Vector mean of directions, so 350 and 10 average to 0 rather than 180.
function meanDirection(degrees) {
  const radians = degrees.map(d => (d * Math.PI) / 180);
  const x = mean(radians.map(Math.cos));
  const y = mean(radians.map(Math.sin));
  const result = round((Math.atan2(y, x) * 180) / Math.PI);
  return ((result % 360) + 360) % 360;
}

function summarise(run, score, qualifies) {
  const values = run.map(slot => slot.values);
  const windFrom = meanDirection(values.map(x => x.windFrom));
  return {
    start: new Date(run[0].startMs).toISOString(),
    end: new Date(run[run.length - 1].startMs + SLOT_MS).toISOString(),
    score: round(score, 1),
    qualifies,
    precipProbMax: round(Math.max(...values.map(x => x.precipProb))),
    precipSum: round(
      values.reduce((sum, x) => sum + x.precip / 4, 0),
      1
    ),
    windAvg: round(mean(values.map(x => x.windSpeed))),
    gustMax: round(Math.max(...values.map(x => x.gust))),
    windFrom,
    windFromCardinal: cardinal(windFrom),
    apparentTempAvg: round(mean(values.map(x => x.apparentTemp)), 1),
    inDaylight: run.every(slot => slot.inDaylight)
  };
}

// Slots must be sorted by start. A run is consecutive 15-minute starts within one availability range.
function pickWindow(slots, durationSlots, { scoreFn = scoreSlot, qualifies = true } = {}) {
  const scores = slots.map(slot => scoreFn(slot.values));
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i + durationSlots <= slots.length; i++) {
    let contiguous = true;
    for (let j = 1; j < durationSlots; j++) {
      const prev = slots[i + j - 1];
      const slot = slots[i + j];
      if (slot.startMs - prev.startMs !== SLOT_MS || slot.rangeIndex !== prev.rangeIndex) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) continue;

    const score = mean(scores.slice(i, i + durationSlots));
    if (score < bestScore - EPSILON) {
      best = i;
      bestScore = score;
    }
  }

  if (best === null) return null;
  return summarise(slots.slice(best, best + durationSlots), bestScore, qualifies);
}

module.exports = { SCORING, DURATIONS, scoreSlot, fallbackScoreSlot, pickWindow, cardinal };

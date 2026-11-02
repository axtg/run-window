const { formatInTimeZone } = require('date-fns-tz');

// "dry" is a claim about the rain chance, so it depends on that alone, not on the client's `rain` limit.
const DRY_MAX_PROBABILITY = 20;

const TEXT = {
  en: { dry: 'dry', rain: 'rain', speed: 'km/h', cardinals: {} },
  nl: {
    dry: 'droog',
    rain: 'regen',
    speed: 'km/u',
    cardinals: { NE: 'NO', E: 'O', SE: 'ZO', S: 'Z', SW: 'ZW' }
  }
};

function formatLabel(window, { timezone, lang }) {
  const text = TEXT[lang] || TEXT.en;
  const from = formatInTimeZone(new Date(window.start), timezone, 'HH:mm');
  const to = formatInTimeZone(new Date(window.end), timezone, 'HH:mm');
  const sky = window.precipProbMax <= DRY_MAX_PROBABILITY ? text.dry : `${text.rain} ${window.precipProbMax}%`;
  const cardinal = text.cardinals[window.windFromCardinal] || window.windFromCardinal;
  const temp = Math.round(window.apparentTempAvg) || 0; // `|| 0` turns -0 into 0
  return `${from}–${to} · ${sky} · ${window.windAvg} ${text.speed} ${cardinal} · ${temp}°C`;
}

module.exports = { formatLabel };

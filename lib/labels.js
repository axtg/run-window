const { formatInTimeZone } = require('date-fns-tz');

// "dry" needs both: a client's high `rain` limit doesn't make 95% dry, and a window that doesn't qualify may have
// measured precipitation at a low chance.
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
  const dry = window.qualifies && window.precipProbMax <= DRY_MAX_PROBABILITY;
  const sky = dry ? text.dry : `${text.rain} ${window.precipProbMax}%`;
  const cardinal = text.cardinals[window.windFromCardinal] || window.windFromCardinal;
  const temp = Math.round(window.apparentTempAvg) || 0; // `|| 0` turns -0 into 0
  return `${from}–${to} · ${sky} · ${window.windAvg} ${text.speed} ${cardinal} · ${temp}°C`;
}

module.exports = { formatLabel };

// "dry" needs both: a high rain limit doesn't make 95% dry. Mirrors lib/labels.js in the API.
const DRY_MAX_PROBABILITY = 20;

const STRINGS = {
  en: {
    week: 'WEEK',
    days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    formLabel: 'Form (est.)',
    headingToday: 'BEST TIME TODAY',
    headingTomorrow: 'TOMORROW',
    minutes: '{n} min',
    dataAt: 'data {time}',
    tokenInvalid:
      'Tredict token paused or invalid. Open the Tredict app, and check the token has the activityRead scope.',
    tredictPayment: "Tredict says this account can't use the API.",
    tredictUnavailable: 'Tredict unavailable',
    tredictDataFrom: 'Tredict data from {time}',
    noTrainingData: 'No training data yet',
    weatherUnavailable: 'Weather unavailable',
    checkHours: 'Check your hours setting',
    setLocation: 'Set your location in the plugin settings',
    noSession: 'no session planned',
    noDuration: '(no duration planned)',
    doesntFit: "doesn't fully fit",
    onlyFits: 'Only {n} min fits your hours',
    noDryFallback: 'No dry window. Least bad 60 min:',
    noDryWindow: 'No dry window in your hours',
    windStart: 'start into the wind ({cardinal})',
    darkAfter: 'dark after {time}',
    weatherStale: 'weather may be out of date',
    dry: 'dry',
    rain: 'rain',
    speed: 'km/h'
  },
  nl: {
    week: 'WEEK',
    days: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    formLabel: 'Vorm (schatting)',
    headingToday: 'BESTE TIJD VANDAAG',
    headingTomorrow: 'MORGEN',
    minutes: '{n} min',
    dataAt: 'data {time}',
    tokenInvalid:
      'Tredict-token gepauzeerd of ongeldig. Open de Tredict-app en controleer of het token de scope activityRead heeft.',
    tredictPayment: 'Tredict meldt dat dit account de API niet kan gebruiken.',
    tredictUnavailable: 'Tredict niet beschikbaar',
    tredictDataFrom: 'Tredict-gegevens van {time}',
    noTrainingData: 'Nog geen trainingsgegevens',
    weatherUnavailable: 'Weer niet beschikbaar',
    checkHours: 'Controleer je uren-instelling',
    setLocation: 'Stel je locatie in bij de plugin-instellingen',
    noSession: 'geen training gepland',
    noDuration: '(geen duur gepland)',
    doesntFit: 'past niet helemaal',
    onlyFits: 'Alleen {n} min past in je uren',
    noDryFallback: 'Geen droog moment. Minst slechte 60 min:',
    noDryWindow: 'Geen droog moment in je uren',
    windStart: 'begin tegen de wind in ({cardinal})',
    darkAfter: 'donker na {time}',
    weatherStale: 'weer is mogelijk verouderd',
    dry: 'droog',
    rain: 'regen',
    speed: 'km/u'
  }
};

// Compass points that differ in Dutch; the others are written the same
const CARDINALS = {
  en: {},
  nl: { NE: 'NO', E: 'O', SE: 'ZO', S: 'Z', SW: 'ZW' }
};

// The setting wins when it is en or nl (any case); 'device' or empty uses the device locale; anything else is en
function resolveLanguage(setting, locale) {
  const chosen = String(setting ?? '').trim();
  const source = chosen === '' || chosen.toLowerCase() === 'device' ? locale : chosen;
  const code = String(source ?? '')
    .trim()
    .slice(0, 2)
    .toLowerCase();
  return STRINGS[code] ? code : 'en';
}

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (values && values[key] !== undefined ? values[key] : ''));
}

function conditionsText(window, lang) {
  const language = STRINGS[lang] ? lang : 'en';
  const text = STRINGS[language];
  const dry = window.qualifies && window.precipProbMax <= DRY_MAX_PROBABILITY;
  const cardinal = CARDINALS[language][window.windFromCardinal] || window.windFromCardinal;
  const temp = Math.round(window.apparentTempAvg) || 0; // `|| 0` turns -0 into 0
  return {
    sky: dry ? text.dry : `${text.rain} ${window.precipProbMax}%`,
    wind: `${window.windAvg} ${text.speed} ${cardinal}`,
    temp: `${temp}°C`
  };
}

function finiteOrZero(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatKm(meters, lang) {
  const text = (Math.round(finiteOrZero(meters) / 100) / 10).toFixed(1);
  return lang === 'nl' ? text.replace('.', ',') : text;
}

function formatDuration(seconds) {
  const minutes = Math.round(finiteOrZero(seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatPace(secondsPerKm) {
  const total = Math.round(finiteOrZero(secondsPerKm));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

module.exports = { STRINGS, resolveLanguage, fill, conditionsText, formatKm, formatDuration, formatPace };

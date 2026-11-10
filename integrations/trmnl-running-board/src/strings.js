// "dry" needs both: a high rain limit doesn't make 95% dry. Mirrors lib/labels.js in the API.
const DRY_MAX_PROBABILITY = 20;

const STRINGS = {
  en: {
    week: 'WEEK',
    days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    formLabel: 'Form',
    headingToday: 'BEST TIME TODAY',
    headingTomorrow: 'TOMORROW',
    minutes: '{n} min',
    dataAt: 'data {time}',
    tokenPaused: 'Tredict token paused. Open the Tredict web app to reactivate it.',
    tokenInvalid: 'Tredict token invalid. Check it has the activityRead scope.',
    intensityHeading: 'Intensity · last 7 days · {time}',
    intensityLow: 'low',
    intensityModerate: 'moderate',
    intensityHigh: 'high',
    tredictPayment: "Tredict says this account can't use the API.",
    tredictUnavailable: 'Tredict unavailable',
    tredictDataFrom: 'Tredict data from {time}',
    noTrainingData: 'No training data yet',
    weatherUnavailable: 'Weather unavailable',
    serviceFull: 'Full for today',
    serviceFullLine: 'New locations again after midnight UTC',
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
    speed: 'km/h',
    sportRunning: 'Run',
    sportCycling: 'Ride',
    sportSwimming: 'Swim',
    sportStrength: 'Strength',
    sportOther: 'Session',
    formWeeksBack: '{n} weeks back',
    formDaysBack: '{n} days back',
    formToday: 'today',
    formDaysAhead: '{n} days ahead'
  },
  nl: {
    week: 'WEEK',
    days: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    formLabel: 'Vorm',
    headingToday: 'BESTE TIJD VANDAAG',
    headingTomorrow: 'MORGEN',
    minutes: '{n} min',
    dataAt: 'data {time}',
    tokenPaused: 'Tredict-token gepauzeerd. Open de Tredict-webapp om het weer te activeren.',
    tokenInvalid: 'Tredict-token ongeldig. Controleer of het de scope activityRead heeft.',
    intensityHeading: 'Intensiteit · laatste 7 dagen · {time}',
    intensityLow: 'laag',
    intensityModerate: 'gemiddeld',
    intensityHigh: 'hoog',
    tredictPayment: 'Tredict meldt dat dit account de API niet kan gebruiken.',
    tredictUnavailable: 'Tredict niet beschikbaar',
    tredictDataFrom: 'Tredict-gegevens van {time}',
    noTrainingData: 'Nog geen trainingsgegevens',
    weatherUnavailable: 'Weer niet beschikbaar',
    serviceFull: 'Vol voor vandaag',
    serviceFullLine: 'Nieuwe locaties weer na middernacht UTC',
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
    speed: 'km/u',
    sportRunning: 'Hardlopen',
    sportCycling: 'Fietsen',
    sportSwimming: 'Zwemmen',
    sportStrength: 'Kracht',
    sportOther: 'Training',
    formWeeksBack: '{n} weken terug',
    formDaysBack: '{n} dagen terug',
    formToday: 'vandaag',
    formDaysAhead: '{n} dagen vooruit'
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

function cardinalText(code, lang) {
  const language = STRINGS[lang] ? lang : 'en';
  return CARDINALS[language][code] || code;
}

function conditionsText(window, lang) {
  const language = STRINGS[lang] ? lang : 'en';
  const text = STRINGS[language];
  const dry = window.qualifies && window.precipProbMax <= DRY_MAX_PROBABILITY;
  const cardinal = cardinalText(window.windFromCardinal, language);
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

module.exports = {
  STRINGS,
  resolveLanguage,
  fill,
  cardinalText,
  conditionsText,
  formatKm,
  formatDuration,
  formatPace
};

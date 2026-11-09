const DayStrip = require('../../public/strip');

const { SHADES, GREY, RAIN, shadeClasses, rangeIndices, ticks, slotLine, chartModel, whySentence } = DayStrip;

const TZ = 'Europe/Amsterdam';

function slot(start, overrides = {}) {
  return {
    start,
    status: 'ok',
    score: 50,
    apparentTemp: 7,
    windSpeed: 14,
    gust: 20,
    windFrom: 90,
    precipProb: 15,
    precip: 0,
    inDaylight: true,
    ...overrides
  };
}

function missing(start) {
  return {
    start,
    status: 'missing',
    score: null,
    apparentTemp: null,
    windSpeed: null,
    gust: null,
    windFrom: null,
    precipProb: null,
    precip: null,
    inDaylight: true
  };
}

// 15-minute slots from 12:00Z (13:00 Amsterdam in winter)
function series(count, make) {
  const base = Date.parse('2026-11-04T12:00:00Z');
  return Array.from({ length: count }, (_, i) => make(new Date(base + i * 900000).toISOString(), i));
}

describe('shadeClasses', () => {
  it('scales ok slots between best and worst, index 4 = best', () => {
    const slots = series(3, (s, i) => slot(s, { score: [10, 60, 110][i] }));
    expect(shadeClasses(slots)).toEqual([SHADES[4], SHADES[2], SHADES[0]]);
  });

  it('uses the best shade when all scores are equal', () => {
    expect(shadeClasses(series(2, s => slot(s)))).toEqual([SHADES[4], SHADES[4]]);
  });

  it('greys past, dark and missing and reddens rain; they do not affect the scale', () => {
    const slots = [
      slot('2026-11-04T12:00:00Z', { status: 'past', score: 1 }),
      slot('2026-11-04T12:15:00Z', { status: 'dark', score: 1 }),
      missing('2026-11-04T12:30:00Z'),
      slot('2026-11-04T12:45:00Z', { status: 'rain', score: 1000 }),
      slot('2026-11-04T13:00:00Z', { score: 5 }),
      slot('2026-11-04T13:15:00Z', { score: 9 })
    ];
    expect(shadeClasses(slots)).toEqual([GREY, GREY, GREY, RAIN, SHADES[4], SHADES[0]]);
  });

  it('handles an empty list', () => {
    expect(shadeClasses([])).toEqual([]);
  });
});

describe('rangeIndices', () => {
  const slots = series(6, s => slot(s));

  it('covers slots with start in [start, end)', () => {
    expect(rangeIndices(slots, '2026-11-04T12:15:00Z', '2026-11-04T12:45:00Z')).toEqual({ first: 1, last: 2 });
  });

  it('excludes the end slot', () => {
    expect(rangeIndices(slots, '2026-11-04T12:00:00Z', '2026-11-04T12:15:00Z')).toEqual({ first: 0, last: 0 });
  });

  it('returns null when nothing matches', () => {
    expect(rangeIndices(slots, '2026-11-05T12:00:00Z', '2026-11-05T13:00:00Z')).toBeNull();
  });
});

describe('ticks', () => {
  it('labels slots at local hours divisible by 3', () => {
    const slots = series(8, s => slot(s)); // 13:00 .. 14:45 local
    expect(ticks(slots, TZ)).toEqual([]);
    const morning = [
      slot('2026-11-04T04:45:00Z'),
      slot('2026-11-04T05:00:00Z'), // 06:00
      slot('2026-11-04T05:15:00Z'),
      slot('2026-11-04T07:45:00Z'),
      slot('2026-11-04T08:00:00Z') // 09:00
    ];
    expect(ticks(morning, TZ)).toEqual([
      { index: 1, label: '06' },
      { index: 4, label: '09' }
    ]);
  });

  it('follows local time across a DST change', () => {
    // 2026-10-25: clocks go back at 01:00Z, so 00:00 local is 22:00Z the day before and 03:00 is 02:00Z
    const slots = [slot('2026-10-24T22:00:00Z'), slot('2026-10-25T02:00:00Z'), slot('2026-10-25T03:00:00Z')];
    expect(ticks(slots, TZ)).toEqual([
      { index: 0, label: '00' },
      { index: 1, label: '03' }
    ]);
  });
});

describe('slotLine', () => {
  it('describes an ok slot', () => {
    expect(slotLine(slot('2026-11-04T12:15:00Z'), TZ)).toBe('13:15 · feels 7 °C · wind 14 km/h E · rain 15 %');
  });

  it('rounds values and avoids -0', () => {
    const line = slotLine(slot('2026-11-04T12:15:00Z', { apparentTemp: -0.2, windSpeed: 13.6, windFrom: 350 }), TZ);
    expect(line).toBe('13:15 · feels 0 °C · wind 14 km/h N · rain 15 %');
  });

  it.each(['dark', 'past', 'rain'])('ends with the %s cue', status => {
    expect(slotLine(slot('2026-11-04T12:15:00Z', { status }), TZ)).toBe(
      `13:15 · feels 7 °C · wind 14 km/h E · rain 15 % · ${status}`
    );
  });

  it('says no data for a missing slot', () => {
    expect(slotLine(missing('2026-11-04T12:15:00Z'), TZ)).toBe('13:15 · no data');
  });
});

describe('chartModel', () => {
  const options = { width: 100, height: 50, range: null, sunsetIso: null };

  it('places slots by index and builds paths on separate scales', () => {
    const slots = series(4, (s, i) => slot(s, { apparentTemp: [0, 10, 10, 0][i], windSpeed: 20 }));
    const model = chartModel(slots, options);
    expect(model.feels).toMatch(/^M0 /);
    expect(model.feels.match(/L/g)).toHaveLength(3);
    // 10 % padding: min 0 -> y at 45.8333, max 10 -> y at 4.1667
    const ys = model.feels.match(/-?\d+(\.\d+)? (-?\d+(\.\d+)?)/g).map(p => Number(p.split(' ')[1]));
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBe(ys[2]);
    expect(ys[0]).toBeLessThan(50);
    expect(ys[1]).toBeGreaterThan(0);
    expect(model.wind).toMatch(/^M0 /);
  });

  it('breaks paths across missing slots', () => {
    const slots = series(5, (s, i) => (i === 2 ? missing(s) : slot(s, { apparentTemp: i, windSpeed: i + 1 })));
    const model = chartModel(slots, options);
    expect(model.feels.match(/M/g)).toHaveLength(2);
    expect(model.feels.match(/L/g)).toHaveLength(2);
    expect(model.wind.match(/M/g)).toHaveLength(2);
  });

  it('draws rain bars at the bottom, 40 % of the height at 100 %', () => {
    const slots = series(4, (s, i) => (i === 3 ? missing(s) : slot(s, { precipProb: [0, 50, 100][i] })));
    const { rain } = chartModel(slots, options);
    expect(rain).toHaveLength(3);
    expect(rain[2]).toEqual({ x: 50, y: 30, width: 25, height: 20 });
    expect(rain[1]).toEqual({ x: 25, y: 40, width: 25, height: 10 });
    expect(rain[0].height).toBe(0);
  });

  it('marks the chosen range as a window', () => {
    const slots = series(4, s => slot(s));
    expect(chartModel(slots, { ...options, range: { first: 1, last: 2 } }).window).toEqual({ x: 25, width: 50 });
    expect(chartModel(slots, options).window).toBeNull();
  });

  it('merges runs of slots without daylight', () => {
    const light = [true, false, false, true, false];
    const slots = series(5, (s, i) => slot(s, { inDaylight: light[i] }));
    expect(chartModel(slots, options).dark).toEqual([
      { x: 20, width: 40 },
      { x: 80, width: 20 }
    ]);
  });

  describe('with a gap between available hours', () => {
    // 07:00-08:45 then 17:00-18:45 UTC
    const starts = [];
    for (const hour of [7, 17]) {
      for (let i = 0; i < 8; i++) {
        const minutes = hour * 60 + i * 15;
        starts.push(
          `2026-11-04T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00Z`
        );
      }
    }
    const gapSlots = starts.map(s => slot(s, { inDaylight: false }));

    it('reports the first slot after the gap', () => {
      expect(chartModel(gapSlots, options).gaps).toEqual([8]);
      expect(
        chartModel(
          series(4, s => slot(s)),
          options
        ).gaps
      ).toEqual([]);
    });

    it('starts a new path segment after the gap', () => {
      const model = chartModel(gapSlots, options);
      expect(model.feels.match(/M/g)).toHaveLength(2);
      expect(model.feels.match(/L/g)).toHaveLength(14);
      expect(model.wind.match(/M/g)).toHaveLength(2);
    });

    it('splits dark runs at the gap', () => {
      expect(chartModel(gapSlots, options).dark).toEqual([
        { x: 0, width: 50 },
        { x: 50, width: 50 }
      ]);
    });
  });

  it('copes with flat values and an empty list', () => {
    const flat = chartModel(
      series(3, s => slot(s)),
      options
    );
    expect(flat.feels).not.toMatch(/NaN/);
    expect(chartModel([], options)).toEqual({ feels: '', wind: '', rain: [], window: null, dark: [], gaps: [] });
  });
});

describe('whySentence', () => {
  // 13:00-13:45 local is the range (indices 0..3); the rest follows
  function day(rangeTemp, restTemp, rangeWind, restWind, tail = []) {
    return series(8, (s, i) => {
      const inRange = i < 4;
      const base = slot(s, {
        apparentTemp: inRange ? rangeTemp : restTemp,
        windSpeed: inRange ? rangeWind : restWind
      });
      return tail[i] ? { ...base, ...tail[i] } : base;
    });
  }
  const range = { first: 0, last: 3 };
  const opts = { timeZone: TZ };

  it('says warmer and less windy', () => {
    expect(whySentence(day(10, 8, 10, 20), range, opts)).toBe('Warmer and less windy than the rest of the day.');
  });

  it('says only warmer', () => {
    expect(whySentence(day(10, 8, 10, 11), range, opts)).toBe('Warmer than the rest of the day.');
  });

  it('says only less windy', () => {
    expect(whySentence(day(8, 8.5, 10, 13), range, opts)).toBe('Less windy than the rest of the day.');
  });

  it('says nothing when nothing stands out, but still names rain after the range', () => {
    expect(whySentence(day(8, 8.5, 10, 11), range, opts)).toBe('');
    const slots = day(8, 8.5, 10, 11, [null, null, null, null, null, { status: 'rain' }]);
    expect(whySentence(slots, range, opts)).toBe('Rain from 14:15.');
  });

  it('says the only dry stretch when no ok slots lie outside the range', () => {
    const slots = day(10, 8, 10, 20, [0, 1, 2, 3].map(() => null).concat(Array(4).fill({ status: 'dark' })));
    expect(whySentence(slots, range, opts)).toBe('The only dry stretch of the day.');
  });

  it('adds rain after the range', () => {
    const slots = day(10, 8, 10, 20, [null, null, null, null, null, { status: 'rain' }]);
    expect(whySentence(slots, range, opts)).toBe('Warmer and less windy than the rest of the day. Rain from 14:15.');
  });

  it('ignores rain before the range', () => {
    const slots = day(10, 8, 10, 20, [{ status: 'rain' }]);
    expect(whySentence(slots, range, opts)).toBe('Warmer and less windy than the rest of the day.');
  });

  it('adds dark from sunset when it falls after the range inside the span', () => {
    const slots = day(10, 8, 10, 20);
    expect(whySentence(slots, range, { ...opts, sunsetIso: '2026-11-04T13:08:00Z' })).toBe(
      'Warmer and less windy than the rest of the day. Dark from 14:08.'
    );
  });

  it('ignores sunset outside the span', () => {
    const slots = day(10, 8, 10, 20);
    expect(whySentence(slots, range, { ...opts, sunsetIso: '2026-11-04T16:00:00Z' })).toBe(
      'Warmer and less windy than the rest of the day.'
    );
    expect(whySentence(slots, range, { ...opts, sunsetIso: '2026-11-04T12:30:00Z' })).toBe(
      'Warmer and less windy than the rest of the day.'
    );
  });

  it('joins rain and dark', () => {
    const slots = day(10, 8, 10, 20, [null, null, null, null, null, { status: 'rain' }]);
    expect(whySentence(slots, range, { ...opts, sunsetIso: '2026-11-04T13:08:00Z' })).toBe(
      'Warmer and less windy than the rest of the day. Rain from 14:15, dark from 14:08.'
    );
  });

  it('returns an empty string without a range', () => {
    expect(whySentence(day(10, 8, 10, 20), null, opts)).toBe('');
  });
});

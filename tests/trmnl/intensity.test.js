const {
  readIntensityCache,
  cacheList,
  intensityOf,
  intensityView
} = require('../../integrations/trmnl-running-board/src/intensity');

const sum = segments => segments.reduce((total, segment) => total + segment.width, 0);

describe('readIntensityCache', () => {
  it('keeps valid entries and drops the rest', () => {
    const map = readIntensityCache([
      ['a', 10, 20, 30],
      ['b', -1, 0, 0],
      ['', 1, 1, 1],
      ['c', 1, 2],
      'x',
      ['d', 1, 2, 3]
    ]);
    expect([...map.keys()]).toEqual(['a', 'd']);
    expect(map.get('d')).toEqual([1, 2, 3]);
  });

  it('drops long ids and non-finite numbers', () => {
    const map = readIntensityCache([
      ['x'.repeat(65), 1, 1, 1],
      ['n', NaN, 1, 1],
      ['s', '1', 1, 1],
      ['ok', 0, 0, 0]
    ]);
    expect([...map.keys()]).toEqual(['ok']);
  });

  it('ignores a non-array', () => {
    for (const value of [{}, null, 'x', undefined]) {
      expect(readIntensityCache(value).size).toBe(0);
    }
  });
});

describe('cacheList', () => {
  it('lists the ids present in the map, in ids order', () => {
    const map = readIntensityCache([
      ['a', 1, 2, 3],
      ['b', 4, 5, 6]
    ]);
    expect(cacheList(map, ['b', 'z', 'a'])).toEqual([
      ['b', 4, 5, 6],
      ['a', 1, 2, 3]
    ]);
  });
});

describe('intensityOf', () => {
  it('reads the heart-rate seconds', () => {
    const data = { summary: { intensityDistribution: { heartrate: { 0: 1800, 1: 600, 2: 120 } } } };
    expect(intensityOf(data)).toEqual([1800, 600, 120]);
  });

  it('gives zeros for missing or null levels', () => {
    expect(intensityOf({ summary: { intensityDistribution: { heartrate: null } } })).toEqual([0, 0, 0]);
    expect(intensityOf({})).toEqual([0, 0, 0]);
    expect(intensityOf(null)).toEqual([0, 0, 0]);
  });

  it('turns negative and non-finite values into 0', () => {
    const data = { summary: { intensityDistribution: { heartrate: { 0: -5, 1: 'x', 2: 30 } } } };
    expect(intensityOf(data)).toEqual([0, 0, 30]);
  });
});

describe('intensityView', () => {
  it('sums, rounds to 100 and formats the total', () => {
    const view = intensityView([[5460, 1190, 350]], 'en');
    expect(view.heading).toBe('Intensity · last 7 days · 1:56');
    expect(view.labels).toEqual(['low 78%', 'moderate 17%', 'high 5%']);
    expect(sum(view.segments)).toBe(360);
    expect(view.segments.map(segment => segment.kind)).toEqual(['low', 'moderate', 'high']);
  });

  it('places each segment after the previous ones', () => {
    const view = intensityView([[5460, 1190, 350]], 'en');
    expect(view.segments[0].x).toBe(0);
    expect(view.segments[1].x).toBe(view.segments[0].width);
    expect(view.segments[2].x).toBe(view.segments[0].width + view.segments[1].width);
  });

  it('rounds the total down to whole minutes', () => {
    expect(intensityView([[2520, 0, 0]], 'en').heading).toBe('Intensity · last 7 days · 0:42');
    expect(intensityView([[9720, 0, 0]], 'en').heading).toBe('Intensity · last 7 days · 2:42');
    expect(intensityView([[3599, 0, 0]], 'en').heading).toBe('Intensity · last 7 days · 0:59');
  });

  it('adds up several runs', () => {
    expect(
      intensityView(
        [
          [1, 2, 3],
          [10, 20, 30]
        ],
        'en'
      ).heading
    ).toBe('Intensity · last 7 days · 0:01');
  });

  it('sums percentages to 100 by largest remainder', () => {
    expect(intensityView([[1, 1, 1]], 'en').labels).toEqual(['low 34%', 'moderate 33%', 'high 33%']);
  });

  it('keeps a tiny range visible', () => {
    const view = intensityView([[10000, 0, 10]], 'en');
    const high = view.segments.find(segment => segment.kind === 'high');
    expect(high.width).toBeGreaterThanOrEqual(4);
    expect(view.segments.some(segment => segment.kind === 'moderate')).toBe(false);
    expect(sum(view.segments)).toBe(360);
  });

  it('gives no bar for zero seconds', () => {
    expect(intensityView([], 'en')).toBeNull();
    expect(intensityView([[0, 0, 0]], 'en')).toBeNull();
  });

  it('speaks Dutch', () => {
    const view = intensityView([[3600, 0, 0]], 'nl');
    expect(view.heading).toBe('Intensiteit · laatste 7 dagen · 1:00');
    expect(view.labels[0]).toBe('laag 100%');
    expect(view.segments).toEqual([{ kind: 'low', x: 0, width: 360 }]);
  });
});

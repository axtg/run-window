const { EVENTS, createTracker, installPlausible } = require('../../public/analytics');

describe('createTracker', () => {
  test('sends an event with its one name property', () => {
    const send = jest.fn();
    const track = createTracker(send);

    expect(track('Setting', 'rain')).toBe(true);
    expect(track('Dialog', 'privacy')).toBe(true);
    expect(track('Source', 'share')).toBe(true);
    expect(track('Network', 'stackcheck.eu')).toBe(true);

    expect(send.mock.calls).toEqual([
      ['Setting', { props: { setting: 'rain' } }],
      ['Dialog', { props: { dialog: 'privacy' } }],
      ['Source', { props: { source: 'share' } }],
      ['Network', { props: { site: 'stackcheck.eu' } }]
    ]);
  });

  test('sends each event and name once per page view', () => {
    const send = jest.fn();
    const track = createTracker(send);

    track('Setting', 'hours');
    track('Setting', 'hours');
    track('Setting', 'pace');

    expect(send.mock.calls.map(([, options]) => options.props.setting)).toEqual(['hours', 'pace']);
  });

  test('drops unknown events and any name not on the list, so a value or coordinate never goes out', () => {
    const send = jest.fn();
    const track = createTracker(send);

    expect(track('Setting', '52.37')).toBe(false);
    expect(track('Setting', 'wind')).toBe(false); // a value of Mind most, not a setting
    expect(track('Route', 'file')).toBe(false);
    expect(track('constructor', 'name')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  test('every name is a short lowercase word or domain', () => {
    Object.values(EVENTS).forEach(({ names }) => names.forEach(name => expect(name).toMatch(/^[a-z][a-z.-]*$/)));
  });

  test('a failing sender never throws into the page', () => {
    const track = createTracker(() => {
      throw new Error('blocked');
    });

    expect(() => track('Dialog', 'api')).not.toThrow();
  });
});

describe('installPlausible', () => {
  test('queues calls until Plausible loads, as its own snippet does, and inits once', () => {
    const root = {};
    const send = installPlausible(root);

    send('Dialog', { props: { dialog: 'method' } });

    expect(root.plausible.o).toEqual({});
    expect(root.plausible.q.map(args => [...args])).toEqual([['Dialog', { props: { dialog: 'method' } }]]);
  });

  test('uses Plausible when it loaded first, and follows it when it replaces the queue later', () => {
    const early = jest.fn();
    early.init = jest.fn();
    const root = { plausible: early };
    const send = installPlausible(root);

    expect(early.init).toHaveBeenCalledTimes(1);
    send('Setting', { props: { setting: 'dark' } });
    expect(early).toHaveBeenCalledWith('Setting', { props: { setting: 'dark' } });

    const later = jest.fn();
    root.plausible = later;
    send('Setting', { props: { setting: 'rain' } });
    expect(later).toHaveBeenCalledWith('Setting', { props: { setting: 'rain' } });
  });
});

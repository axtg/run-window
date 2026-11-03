const {
  localDate,
  localTime,
  addDays,
  weekDates,
  isoWeek,
  dayOfWeek,
  zonedMidnight,
  availabilityEnd
} = require('../../integrations/trmnl-running-board/src/time');

const AMS = 'Europe/Amsterdam';
const ms = iso => Date.parse(iso);

describe('localDate and localTime', () => {
  it('converts across the day boundary', () => {
    expect(localDate(ms('2026-11-01T23:30:00Z'), AMS)).toBe('2026-11-02');
    expect(localTime(ms('2026-11-01T23:30:00Z'), AMS)).toBe('00:30');
  });

  it('handles the DST change on 2026-10-25 (Review Focus 3)', () => {
    expect(localDate(ms('2026-10-24T22:30:00Z'), AMS)).toBe('2026-10-25');
    expect(localTime(ms('2026-10-24T22:30:00Z'), AMS)).toBe('00:30');
    expect(localDate(ms('2026-10-25T22:30:00Z'), AMS)).toBe('2026-10-25');
    expect(localTime(ms('2026-10-25T22:30:00Z'), AMS)).toBe('23:30');
  });

  it('prints midnight as 00:00, not 24:00', () => {
    expect(localTime(ms('2026-11-01T23:00:00Z'), AMS)).toBe('00:00');
  });

  it('falls back to UTC for a bad time zone', () => {
    expect(localDate(ms('2026-11-01T23:30:00Z'), 'Not/AZone')).toBe('2026-11-01');
    expect(localTime(ms('2026-11-01T23:30:00Z'), undefined)).toBe('23:30');
  });
});

describe('calendar arithmetic', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('gives the week Monday first', () => {
    expect(weekDates('2026-11-08')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08'
    ]);
    expect(weekDates('2026-11-02')[0]).toBe('2026-11-02');
  });

  it('numbers days with Monday 0', () => {
    expect(dayOfWeek('2026-11-02')).toBe(0);
    expect(dayOfWeek('2026-11-08')).toBe(6);
  });

  it('computes the ISO week', () => {
    expect(isoWeek('2026-11-04')).toBe(45);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2026-12-28')).toBe(53);
    expect(isoWeek('2026-01-01')).toBe(1);
  });
});

describe('zonedMidnight', () => {
  it('finds the local midnight', () => {
    expect(zonedMidnight('2026-11-04', AMS)).toBe(ms('2026-11-03T23:00:00Z'));
    expect(zonedMidnight('2026-07-04', AMS)).toBe(ms('2026-07-03T22:00:00Z'));
  });

  it('handles the 23 and 25 hour days', () => {
    expect(zonedMidnight('2026-03-29', AMS)).toBe(ms('2026-03-28T23:00:00Z'));
    expect(zonedMidnight('2026-03-30', AMS)).toBe(ms('2026-03-29T22:00:00Z'));
    expect(zonedMidnight('2026-10-25', AMS)).toBe(ms('2026-10-24T22:00:00Z'));
    expect(zonedMidnight('2026-10-26', AMS)).toBe(ms('2026-10-25T23:00:00Z'));
  });

  it('works for a zone ahead of UTC', () => {
    expect(zonedMidnight('2026-11-04', 'Pacific/Auckland')).toBe(ms('2026-11-03T11:00:00Z'));
  });
});

describe('availabilityEnd', () => {
  it('ends at the last range of that local day', () => {
    expect(availabilityEnd('07-09,17-21', '2026-11-04', AMS)).toBe(ms('2026-11-04T20:00:00Z'));
    expect(availabilityEnd('17-21,07-09', '2026-11-04', AMS)).toBe(ms('2026-11-04T20:00:00Z'));
  });

  it('treats 24 as the next midnight', () => {
    expect(availabilityEnd('20-24', '2026-11-04', AMS)).toBe(ms('2026-11-04T23:00:00Z'));
  });

  it('uses the wall clock on the spring-forward day', () => {
    expect(availabilityEnd('17-21', '2026-03-29', AMS)).toBe(ms('2026-03-29T19:00:00Z'));
  });

  it('falls back to the end of the day when no range parses', () => {
    expect(availabilityEnd('', '2026-11-04', AMS)).toBe(ms('2026-11-04T23:00:00Z'));
    expect(availabilityEnd(undefined, '2026-11-04', AMS)).toBe(ms('2026-11-04T23:00:00Z'));
    expect(availabilityEnd('garbage', '2026-11-04', AMS)).toBe(ms('2026-11-04T23:00:00Z'));
  });
});

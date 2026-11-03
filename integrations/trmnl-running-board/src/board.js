function buildBoard(input, { now }) {
  return { v: 1, fetchedAt: new Date(now).toISOString(), fetchedAtText: '' };
}

module.exports = { buildBoard };

// Indirection so tests can move time forward without waiting.
let override = null;

module.exports = {
  now: () => (override ? new Date(override) : new Date()),
  set: (date) => { override = date ? new Date(date) : null; },
};

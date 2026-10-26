const db = require('../db');
const config = require('../config');
const { runSchedulerTick } = require('./activations');
const { sendDueReminders } = require('./reminders');

const LOCK_ID = 90210;
let timer = null;

// The advisory lock keeps two replicas from running the same tick at once.
async function tick() {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!rows[0].ok) return;
    try {
      const result = { ...(await runSchedulerTick()), reminders: await sendDueReminders() };
      if (Object.values(result).some(Boolean)) console.log('[scheduler]', result);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } catch (err) {
    console.error('[scheduler] tick failed:', err);
  } finally {
    client.release();
  }
}

function start() {
  if (!config.schedulerEnabled || timer) return;
  timer = setInterval(tick, config.schedulerIntervalMs);
  timer.unref();
  tick();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };

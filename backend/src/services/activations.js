const db = require('../db');
const audit = require('./audit');
const sms = require('./sms');
const config = require('../config');
const clock = require('../utils/clock');
const { decrypt } = require('../utils/crypto');
const HttpError = require('../utils/httpError');

const OPEN_STATUSES = ['checkin_pending', 'awaiting_admin', 'scheduled', 'dispatching'];
const CANCELLABLE_STATUSES = ['checkin_pending', 'awaiting_admin', 'scheduled'];
const HOUR = 60 * 60 * 1000;

const addHours = (date, hours) => new Date(date.getTime() + hours * HOUR);

async function alertOwner(user, body) {
  const phone = decrypt(user.phone_enc);
  if (!phone) return;
  try {
    await sms.send(phone, body);
  } catch (err) {
    console.error(`Failed to alert user ${user.id}:`, err.message);
  }
}

async function recipientCount(userId, client = db) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM template_recipients tr
       JOIN message_templates t ON t.id = tr.template_id
      WHERE t.user_id = $1`,
    [userId]
  );
  return rows[0].n;
}

async function insertActivation(client, fields) {
  try {
    const { rows } = await client.query(
      `INSERT INTO activations (user_id, source, status, check_in_deadline, dispatch_at, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [fields.userId, fields.source, fields.status, fields.checkInDeadline || null,
        fields.dispatchAt || null, fields.createdBy || null, fields.now]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'A notification run is already in progress');
    throw err;
  }
}

// Moves an activation from one status to another only if nobody else moved it first.
async function transition(client, id, fromStatuses, set) {
  const keys = Object.keys(set);
  const assignments = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const { rows } = await client.query(
    `UPDATE activations SET ${assignments}, updated_at = now()
      WHERE id = $1 AND status = ANY($2) RETURNING *`,
    [id, fromStatuses, ...keys.map((k) => set[k])]
  );
  return rows[0] || null;
}

async function triggerManual(user, ip) {
  const now = clock.now();
  if ((await recipientCount(user.id)) === 0) {
    throw new HttpError(422, 'Add at least one message with recipients before triggering');
  }
  const dispatchAt = addHours(now, user.dispatch_delay_hours);
  const activation = await db.withTransaction(async (client) => {
    const row = await insertActivation(client, {
      userId: user.id, source: 'manual', status: 'scheduled', dispatchAt, createdBy: user.id, now,
    });
    await audit.record({ userId: user.id, actorId: user.id, action: 'activation.triggered',
      details: { activationId: row.id, dispatchAt }, ip }, client);
    return row;
  });
  await alertOwner(user, `Legacy Planner: your messages are scheduled to send at ${dispatchAt.toISOString()}. `
    + 'Sign in and cancel if this was not you.');
  return activation;
}

async function cancel(activation, actor, reason, ip) {
  const row = await transition(db, activation.id, CANCELLABLE_STATUSES, {
    status: 'cancelled', cancelled_by: actor ? actor.id : null, cancel_reason: reason, completed_at: clock.now(),
  });
  if (!row) throw new HttpError(409, 'This run can no longer be cancelled');
  await audit.record({ userId: activation.user_id, actorId: actor ? actor.id : null,
    action: 'activation.cancelled', details: { activationId: activation.id, reason }, ip });
  return row;
}

// Signing in or checking in proves the user is fine, so inactivity runs stop.
async function cancelInactivityRuns(user, reason, ip) {
  const { rows } = await db.query(
    `UPDATE activations SET status = 'cancelled', cancel_reason = $2, cancelled_by = $1,
            completed_at = now(), updated_at = now()
      WHERE user_id = $1 AND source = 'inactivity' AND status = ANY($3) RETURNING id`,
    [user.id, reason, CANCELLABLE_STATUSES]
  );
  for (const { id } of rows) {
    await audit.record({ userId: user.id, actorId: user.id, action: 'activation.cancelled',
      details: { activationId: id, reason }, ip });
  }
  return rows.length;
}

async function confirmByAdmin(activationId, admin, ip) {
  const { rows } = await db.query(
    'SELECT a.*, u.dispatch_delay_hours, u.phone_enc FROM activations a JOIN users u ON u.id = a.user_id WHERE a.id = $1',
    [activationId]
  );
  const activation = rows[0];
  if (!activation) throw new HttpError(404, 'Activation not found');
  if (activation.user_id === admin.id) throw new HttpError(403, 'Admins cannot confirm their own notification run');
  const dispatchAt = addHours(clock.now(), activation.dispatch_delay_hours);
  const row = await transition(db, activationId, ['awaiting_admin'], {
    status: 'scheduled', confirmed_by: admin.id, dispatch_at: dispatchAt,
  });
  if (!row) throw new HttpError(409, 'This run is not waiting for confirmation');
  await audit.record({ userId: activation.user_id, actorId: admin.id, action: 'activation.admin_confirmed',
    details: { activationId, dispatchAt }, ip });
  await alertOwner(activation, `Legacy Planner: an administrator confirmed your notification run. Messages send at ${dispatchAt.toISOString()} unless you sign in.`);
  return row;
}

async function startInactivityChecks(now) {
  const { rows: users } = await db.query(
    `SELECT u.* FROM users u
      WHERE u.inactivity_enabled
        AND u.last_active_at < $1::timestamptz - make_interval(days => u.inactivity_days)
        AND NOT EXISTS (SELECT 1 FROM activations a WHERE a.user_id = u.id AND a.status = ANY($2))
        AND NOT EXISTS (SELECT 1 FROM activations a WHERE a.user_id = u.id AND a.source = 'inactivity'
                          AND a.created_at > u.last_active_at)`,
    [now, OPEN_STATUSES]
  );
  let started = 0;
  for (const user of users) {
    if ((await recipientCount(user.id)) === 0) continue;
    const deadline = addHours(now, user.checkin_grace_hours);
    try {
      const row = await insertActivation(db, {
        userId: user.id, source: 'inactivity', status: 'checkin_pending', checkInDeadline: deadline, now,
      });
      await audit.record({ userId: user.id, action: 'activation.checkin_requested',
        details: { activationId: row.id, checkInDeadline: deadline } });
      await alertOwner(user, `Legacy Planner: we haven't seen you in ${user.inactivity_days} days. `
        + `Sign in before ${deadline.toISOString()} or your prepared messages will be sent.`);
      started += 1;
    } catch (err) {
      if (err.status !== 409) throw err;
    }
  }
  return started;
}

async function cancelRunsForActiveUsers(now) {
  const { rows } = await db.query(
    `UPDATE activations a SET status = 'cancelled', cancel_reason = 'user_active',
            completed_at = $2, updated_at = now()
       FROM users u
      WHERE u.id = a.user_id AND a.source = 'inactivity' AND a.status = ANY($1)
        AND u.last_active_at > a.created_at
      RETURNING a.id, a.user_id`,
    [CANCELLABLE_STATUSES, now]
  );
  for (const row of rows) {
    await audit.record({ userId: row.user_id, action: 'activation.cancelled',
      details: { activationId: row.id, reason: 'user_active' } });
  }
  return rows.length;
}

async function escalateExpiredCheckins(now) {
  const { rows } = await db.query(
    `SELECT a.*, u.require_admin_confirmation, u.dispatch_delay_hours, u.phone_enc
       FROM activations a JOIN users u ON u.id = a.user_id
      WHERE a.status = 'checkin_pending' AND a.check_in_deadline <= $1`,
    [now]
  );
  for (const activation of rows) {
    const set = activation.require_admin_confirmation
      ? { status: 'awaiting_admin' }
      : { status: 'scheduled', dispatch_at: addHours(now, activation.dispatch_delay_hours) };
    const row = await transition(db, activation.id, ['checkin_pending'], set);
    if (!row) continue;
    await audit.record({ userId: activation.user_id, action: `activation.${row.status}`,
      details: { activationId: row.id, dispatchAt: row.dispatch_at } });
    if (row.status === 'scheduled') {
      await alertOwner(activation, `Legacy Planner: final notice. Your messages send at ${row.dispatch_at.toISOString()} unless you sign in.`);
    }
  }
  return rows.length;
}

async function dispatch(activation, now) {
  const claimed = await transition(db, activation.id, ['scheduled'], { status: 'dispatching' });
  if (!claimed) return null;

  const { rows: messages } = await db.query(
    `SELECT t.id AS template_id, t.body_enc, c.id AS contact_id, c.name_enc, c.phone_enc
       FROM message_templates t
       JOIN template_recipients tr ON tr.template_id = t.id
       JOIN contacts c ON c.id = tr.contact_id
      WHERE t.user_id = $1
        AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.activation_id = $2
                          AND d.template_id = t.id AND d.contact_id = c.id)`,
    [activation.user_id, activation.id]
  );

  for (const m of messages) {
    const name = decrypt(m.name_enc);
    const body = decrypt(m.body_enc).replace(/\{\{\s*name\s*\}\}/gi, name);
    let status = 'sent';
    let providerId = null;
    let error = null;
    try {
      ({ id: providerId } = await sms.send(decrypt(m.phone_enc), body));
    } catch (err) {
      status = 'failed';
      error = err.message.slice(0, 500);
    }
    await db.query(
      `INSERT INTO deliveries (activation_id, template_id, contact_id, status, provider_id, error)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [activation.id, m.template_id, m.contact_id, status, providerId, error]
    );
  }

  const { rows: [counts] } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM deliveries WHERE activation_id = $1`,
    [activation.id]
  );
  const finalStatus = counts.sent > 0 || counts.failed === 0 ? 'sent' : 'failed';
  const done = await transition(db, activation.id, ['dispatching'], { status: finalStatus, completed_at: now });
  await audit.record({ userId: activation.user_id, action: `activation.${finalStatus}`,
    details: { activationId: activation.id, ...counts } });
  return done;
}

async function dispatchDue(now) {
  if (!config.notificationsEnabled) return 0;
  const { rows } = await db.query(
    "SELECT * FROM activations WHERE status = 'scheduled' AND dispatch_at <= $1 ORDER BY dispatch_at",
    [now]
  );
  let sent = 0;
  for (const activation of rows) {
    if (await dispatch(activation, now)) sent += 1;
  }
  return sent;
}

// One pass of the background job. Order matters: a user who came back is
// cleared before anything escalates or sends.
async function runSchedulerTick(now = clock.now()) {
  const cancelled = await cancelRunsForActiveUsers(now);
  const started = await startInactivityChecks(now);
  const escalated = await escalateExpiredCheckins(now);
  const dispatched = await dispatchDue(now);
  return { cancelled, started, escalated, dispatched };
}

module.exports = {
  OPEN_STATUSES,
  triggerManual,
  cancel,
  cancelInactivityRuns,
  confirmByAdmin,
  runSchedulerTick,
};

const db = require('../db');
const audit = require('./audit');
const sms = require('./sms');
const clock = require('../utils/clock');
const { decrypt } = require('../utils/crypto');

const MAX_LISTED = 5;

const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function composeReminder(tasks, today) {
  const overdue = tasks.filter((t) => t.due_date < today);
  const upcoming = tasks.filter((t) => t.due_date >= today);
  const parts = [];
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  if (upcoming.length) parts.push(`${upcoming.length} due soon`);
  const listed = tasks.slice(0, MAX_LISTED).map((t) => `- ${t.title} (${shortDate(t.due_date)})`);
  const more = tasks.length > MAX_LISTED ? `\n…and ${tasks.length - MAX_LISTED} more` : '';
  return `Legacy Planner: ${parts.join(', ')} on your checklist.\n${listed.join('\n')}${more}`;
}

// Texts each opted-in user a short list of overdue and upcoming tasks, at most
// once per their interval. Claiming the slot with a conditional UPDATE means two
// scheduler instances can never both send the same reminder.
async function sendDueReminders(now = clock.now()) {
  const { rows: users } = await db.query(
    `UPDATE users SET last_reminder_at = $1
      WHERE reminders_enabled AND phone_enc IS NOT NULL
        AND (last_reminder_at IS NULL
             OR last_reminder_at <= $1::timestamptz - make_interval(days => reminder_interval_days))
      RETURNING id, phone_enc, reminder_lookahead_days`,
    [now]
  );
  const today = new Date(now.toISOString().slice(0, 10));
  let sent = 0;
  for (const user of users) {
    const { rows: tasks } = await db.query(
      `SELECT title, due_date FROM checklist_items
        WHERE user_id = $1 AND status = 'pending' AND due_date IS NOT NULL
          AND due_date <= ($2::timestamptz AT TIME ZONE 'UTC')::date + $3::int
        ORDER BY due_date, title`,
      [user.id, now, user.reminder_lookahead_days]
    );
    if (tasks.length === 0) continue;
    try {
      await sms.send(decrypt(user.phone_enc), composeReminder(tasks, today));
      await audit.record({ userId: user.id, action: 'reminder.sent', details: { tasks: tasks.length } });
      sent += 1;
    } catch (err) {
      console.error(`Reminder to user ${user.id} failed:`, err.message);
    }
  }
  return sent;
}

module.exports = { sendDueReminders, composeReminder };

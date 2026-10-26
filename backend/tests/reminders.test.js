const { db, sms, resetDb, registerUser, api } = require('./helpers');
const { sendDueReminders, composeReminder } = require('../src/services/reminders');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-10T15:00:00Z');
const at = (days) => new Date(NOW.getTime() + days * DAY);
const date = (days) => at(days).toISOString().slice(0, 10);
const textsTo = (phone) => sms.sentInMockMode.filter((m) => m.to === phone);

beforeEach(resetDb);
afterAll(() => db.pool.end());

async function userWithTasks(settings = { remindersEnabled: true }) {
  const user = await registerUser();
  const client = api(user);
  await client.patch('/api/me', { phone: '+14155550100', ...settings }).expect(200);
  await client.post('/api/checklist', { title: 'Sign will', dueDate: date(-2) }).expect(201);
  await client.post('/api/checklist', { title: 'Call bank', dueDate: date(3) }).expect(201);
  await client.post('/api/checklist', { title: 'Far away', dueDate: date(40) }).expect(201);
  await client.post('/api/checklist', { title: 'No date' }).expect(201);
  const done = (await client.post('/api/checklist', { title: 'Already done', dueDate: date(-5) }).expect(201)).body.item;
  await client.patch(`/api/checklist/${done.id}`, { status: 'completed' }).expect(200);
  return { user, client };
}

test('reminders cannot be turned on without a phone number', async () => {
  await api(await registerUser()).patch('/api/me', { remindersEnabled: true }).expect(422);
});

test('texts overdue and upcoming pending tasks only', async () => {
  await userWithTasks();
  expect(await sendDueReminders(NOW)).toBe(1);
  const [text] = textsTo('+14155550100');
  expect(text.body).toBe('Legacy Planner: 1 overdue, 1 due soon on your checklist.\n- Sign will (Mar 8)\n- Call bank (Mar 13)');
});

test('sends at most once per interval, even with overlapping runs', async () => {
  await userWithTasks({ remindersEnabled: true, reminderIntervalDays: 7 });
  await Promise.all([sendDueReminders(NOW), sendDueReminders(NOW)]);
  await sendDueReminders(at(6));
  expect(textsTo('+14155550100')).toHaveLength(1);
  await sendDueReminders(at(7));
  expect(textsTo('+14155550100')).toHaveLength(2);
});

test('sends nothing when reminders are off or nothing is due', async () => {
  await userWithTasks({ remindersEnabled: false });
  const quiet = await registerUser();
  await api(quiet).patch('/api/me', { phone: '+14155550199', remindersEnabled: true }).expect(200);
  expect(await sendDueReminders(NOW)).toBe(0);
  expect(sms.sentInMockMode).toHaveLength(0);
});

test('lists at most five tasks', () => {
  const tasks = Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, due_date: new Date('2027-03-12') }));
  const body = composeReminder(tasks, new Date('2027-03-10'));
  expect(body).toContain('7 due soon');
  expect(body).toContain('…and 2 more');
  expect(body.split('\n- ')).toHaveLength(6);
});

const request = require('supertest');
const { app, db, clock, sms, resetDb, registerUser, api, readyUser } = require('./helpers');
const { runSchedulerTick } = require('../src/services/activations');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PHRASE = 'SEND MY MESSAGES';

beforeEach(resetDb);
afterAll(() => db.pool.end());

const later = (ms) => new Date(Date.now() + ms);
const sentTo = (phone) => sms.sentInMockMode.filter((m) => m.to === phone);

describe('manual trigger safeguards', () => {
  test('needs the exact phrase, the right password and at least one recipient', async () => {
    const empty = api(await registerUser());
    await empty.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: PHRASE }).expect(422);

    const { client } = await readyUser();
    await client.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: 'SEND' }).expect(422);
    await client.post('/api/activations', { password: 'wrong-password-9', confirmationPhrase: PHRASE }).expect(403);
    expect((await client.get('/api/activations').expect(200)).body.current).toBeNull();
  });

  test('schedules with a delay, warns the owner, and sends nothing before the delay', async () => {
    const { client } = await readyUser({ dispatchDelayHours: 6 });
    const { activation } = (await client.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: PHRASE }).expect(201)).body;
    expect(activation.status).toBe('scheduled');
    expect(new Date(activation.dispatchAt) - Date.now()).toBeGreaterThan(5.9 * HOUR);
    expect(sentTo('+14155550100')).toHaveLength(1); // the owner's warning

    await runSchedulerTick(later(5 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(0);

    await runSchedulerTick(later(7 * HOUR));
    expect(sentTo('+14155550111')).toEqual([expect.objectContaining({ body: 'Hi Sam, this is my message.' })]);
    const { body } = await client.get('/api/activations').expect(200);
    expect(body.activations[0].status).toBe('sent');
  });

  test('a second trigger is refused while one is open', async () => {
    const { client } = await readyUser();
    await client.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: PHRASE }).expect(201);
    await client.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: PHRASE }).expect(409);
  });

  test('cancelling needs the password and stops the send', async () => {
    const { client } = await readyUser();
    const { activation } = (await client.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: PHRASE }).expect(201)).body;
    await client.post(`/api/activations/${activation.id}/cancel`, { password: 'nope-nope-12' }).expect(403);
    await client.post(`/api/activations/${activation.id}/cancel`, { password: 'correct-horse-1' }).expect(200);
    await runSchedulerTick(later(48 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(0);
    await client.post(`/api/activations/${activation.id}/cancel`, { password: 'correct-horse-1' }).expect(409);
  });

  test('dispatch runs once even if the scheduler ticks twice', async () => {
    const { client } = await readyUser({ dispatchDelayHours: 1 });
    await client.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: PHRASE }).expect(201);
    await Promise.all([runSchedulerTick(later(2 * HOUR)), runSchedulerTick(later(2 * HOUR))]);
    expect(sentTo('+14155550111')).toHaveLength(1);
  });

  test('every step lands in the audit log', async () => {
    const { client } = await readyUser({ dispatchDelayHours: 1 });
    await client.post('/api/activations', { password: 'wrong-password-9', confirmationPhrase: PHRASE }).expect(403);
    await client.post('/api/activations', { password: 'correct-horse-1', confirmationPhrase: PHRASE }).expect(201);
    await runSchedulerTick(later(2 * HOUR));
    const actions = (await client.get('/api/audit?limit=100').expect(200)).body.entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining([
      'activation.trigger.password_rejected', 'activation.triggered', 'activation.sent',
    ]));
  });
});

describe('inactivity trigger', () => {
  const settings = { inactivityEnabled: true, inactivityDays: 30, checkinGraceHours: 72, dispatchDelayHours: 24 };

  test('cannot be enabled without the owner\'s phone number', async () => {
    const client = api(await registerUser());
    await client.patch('/api/me', { inactivityEnabled: true }).expect(422);
  });

  test('asks the owner to check in, then schedules, then sends', async () => {
    const { client } = await readyUser(settings);

    await runSchedulerTick(later(29 * DAY));
    expect((await db.query('SELECT count(*)::int AS n FROM activations')).rows[0].n).toBe(0);

    await runSchedulerTick(later(31 * DAY));
    let { rows } = await db.query('SELECT * FROM activations');
    expect(rows[0]).toMatchObject({ source: 'inactivity', status: 'checkin_pending' });
    expect(sentTo('+14155550100').at(-1).body).toMatch(/haven't seen you/);

    await runSchedulerTick(later(31 * DAY + 73 * HOUR));
    ({ rows } = await db.query('SELECT * FROM activations'));
    expect(rows[0].status).toBe('scheduled');
    expect(sentTo('+14155550111')).toHaveLength(0);

    await runSchedulerTick(later(31 * DAY + 98 * HOUR));
    ({ rows } = await db.query('SELECT * FROM activations'));
    expect(rows[0].status).toBe('sent');
    expect(sentTo('+14155550111')).toHaveLength(1);

    // It does not fire again until the user has been active and gone quiet again.
    await runSchedulerTick(later(90 * DAY));
    expect((await db.query('SELECT count(*)::int AS n FROM activations')).rows[0].n).toBe(1);
    void client;
  });

  test('signing in during the check-in window cancels it', async () => {
    const { user } = await readyUser(settings);
    await runSchedulerTick(later(31 * DAY));

    clock.set(later(32 * DAY));
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password }).expect(200);
    expect(res.body.cancelledInactivityRuns).toBe(1);

    await runSchedulerTick(later(40 * DAY));
    expect(sentTo('+14155550111')).toHaveLength(0);
  });

  test('any signed-in activity cancels a scheduled inactivity run before it sends', async () => {
    const { client } = await readyUser(settings);
    await runSchedulerTick(later(31 * DAY));
    await runSchedulerTick(later(31 * DAY + 73 * HOUR));
    expect((await db.query('SELECT status FROM activations')).rows[0].status).toBe('scheduled');

    clock.set(later(31 * DAY + 80 * HOUR));
    await client.get('/api/checklist').expect(200);
    await runSchedulerTick(later(31 * DAY + 120 * HOUR));
    expect((await db.query('SELECT status, cancel_reason FROM activations')).rows[0])
      .toEqual({ status: 'cancelled', cancel_reason: 'user_active' });
    expect(sentTo('+14155550111')).toHaveLength(0);
  });

  test('with admin confirmation on, nothing sends until an admin confirms', async () => {
    const { client } = await readyUser({ ...settings, requireAdminConfirmation: true });
    const admin = await registerUser();
    await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);

    await runSchedulerTick(later(31 * DAY));
    await runSchedulerTick(later(31 * DAY + 73 * HOUR));
    await runSchedulerTick(later(60 * DAY));
    expect(sentTo('+14155550111')).toHaveLength(0);

    await client.get('/api/admin/activations').expect(403);
    const pending = (await api(admin).get('/api/admin/activations?status=awaiting_admin').expect(200)).body.activations;
    expect(pending).toHaveLength(1);

    clock.set(later(60 * DAY));
    await api(admin).post(`/api/admin/activations/${pending[0].id}/confirm`).expect(200);
    await runSchedulerTick(later(60 * DAY + 25 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(1);
  });

  test('an admin can reject a run but cannot confirm their own', async () => {
    const { user } = await readyUser({ ...settings, requireAdminConfirmation: true });
    await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
    await runSchedulerTick(later(31 * DAY));
    await runSchedulerTick(later(31 * DAY + 73 * HOUR));
    const { rows: [run] } = await db.query('SELECT id FROM activations');

    await api(user).post(`/api/admin/activations/${run.id}/confirm`).expect(403);
    await api(user).post(`/api/admin/activations/${run.id}/reject`).expect(200);
    expect((await db.query('SELECT status FROM activations')).rows[0].status).toBe('cancelled');
  });
});

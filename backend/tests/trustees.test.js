const request = require('supertest');
const { app, db, clock, sms, resetDb, registerUser, api, readyUser } = require('./helpers');
const { runSchedulerTick } = require('../src/services/activations');

const HOUR = 60 * 60 * 1000;
const PW = 'correct-horse-1';

beforeEach(resetDb);
afterAll(() => db.pool.end());

const later = (ms) => new Date(Date.now() + ms);
const sentTo = (phone) => sms.sentInMockMode.filter((m) => m.to === phone);

// Owner with messages ready, plus a trustee who has accepted.
async function ownerWithTrustee(permissions = {}, settings = {}) {
  const { user: owner, client } = await readyUser({ checkinGraceHours: 48, dispatchDelayHours: 12, ...settings });
  const trustee = await registerUser();
  const link = (await client.post('/api/trustees', { email: trustee.email, ...permissions }).expect(201)).body.trustee;
  const invites = (await api(trustee).get('/api/trustees/invitations').expect(200)).body.invitations;
  expect(invites).toHaveLength(1);
  await api(trustee).post(`/api/trustees/invitations/${invites[0].id}/accept`).expect(200);
  return { owner, client, trustee, link };
}

describe('managing emergency contacts', () => {
  test('owner can add, update and remove; duplicates and self are refused', async () => {
    const owner = await registerUser();
    const client = api(owner);
    await client.post('/api/trustees', { email: owner.email }).expect(422);
    const t = (await client.post('/api/trustees', { email: 'friend@example.com' }).expect(201)).body.trustee;
    expect(t).toMatchObject({ status: 'invited', canReport: true, canConfirm: false });
    await client.post('/api/trustees', { email: 'friend@example.com' }).expect(409);
    expect((await client.patch(`/api/trustees/${t.id}`, { canConfirm: true }).expect(200)).body.trustee.canConfirm).toBe(true);
    await client.delete(`/api/trustees/${t.id}`).expect(204);
    expect((await client.get('/api/trustees').expect(200)).body.trustees).toHaveLength(0);
  });

  test('only the invited person can accept, and trustees see no private data', async () => {
    const { owner, trustee } = await ownerWithTrustee();
    const stranger = await registerUser();
    expect((await api(stranger).get('/api/trustees/people').expect(200)).body.people).toHaveLength(0);

    const people = (await api(trustee).get('/api/trustees/people').expect(200)).body.people;
    expect(people).toEqual([expect.objectContaining({ id: owner.id, canReport: true, currentRun: null })]);
    expect(Object.keys(people[0]).sort()).toEqual(['canConfirm', 'canReport', 'currentRun', 'email', 'id', 'name']);
  });

  test('trustee confirmation cannot be required until a confirming contact has accepted', async () => {
    const { client, link } = await ownerWithTrustee();
    await client.patch('/api/me', { requireTrusteeConfirmation: true }).expect(422);
    await client.patch(`/api/trustees/${link.id}`, { canConfirm: true }).expect(200);
    await client.patch('/api/me', { requireTrusteeConfirmation: true }).expect(200);
  });
});

describe('trustee reports', () => {
  test('a report needs permission and the trustee\'s password', async () => {
    const { owner, trustee, client, link } = await ownerWithTrustee();
    const stranger = await registerUser();
    await api(stranger).post(`/api/trustees/people/${owner.id}/report`, { password: PW }).expect(404);
    await api(trustee).post(`/api/trustees/people/${owner.id}/report`, { password: 'wrong-pass-123' }).expect(403);
    await client.patch(`/api/trustees/${link.id}`, { canReport: false }).expect(200);
    await api(trustee).post(`/api/trustees/people/${owner.id}/report`, { password: PW }).expect(403);
  });

  test('a report warns the owner, waits the grace period and delay, then sends', async () => {
    const { owner, trustee } = await ownerWithTrustee();
    const { activation } = (await api(trustee).post(`/api/trustees/people/${owner.id}/report`, { password: PW }).expect(201)).body;
    expect(activation).toMatchObject({ source: 'trustee', status: 'checkin_pending', reportedBy: trustee.id });
    expect(sentTo('+14155550100').at(-1).body).toMatch(/reported that something has happened/);
    await api(trustee).post(`/api/trustees/people/${owner.id}/report`, { password: PW }).expect(409);

    await runSchedulerTick(later(47 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(0);
    await runSchedulerTick(later(49 * HOUR));
    expect((await db.query('SELECT status FROM activations')).rows[0].status).toBe('scheduled');
    await runSchedulerTick(later(62 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(1);
  });

  test('the owner signing in cancels a report', async () => {
    const { owner, trustee } = await ownerWithTrustee();
    await api(trustee).post(`/api/trustees/people/${owner.id}/report`, { password: PW }).expect(201);
    clock.set(later(HOUR));
    const res = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password }).expect(200);
    expect(res.body.cancelledInactivityRuns).toBe(1);
    await runSchedulerTick(later(100 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(0);
  });

  test('the reporter can withdraw their own report', async () => {
    const { owner, trustee } = await ownerWithTrustee();
    const { activation } = (await api(trustee).post(`/api/trustees/people/${owner.id}/report`, { password: PW }).expect(201)).body;
    await api(trustee).post(`/api/trustees/people/${owner.id}/activations/${activation.id}/withdraw`, { password: PW }).expect(200);
    expect((await db.query('SELECT status, cancel_reason FROM activations')).rows[0])
      .toEqual({ status: 'cancelled', cancel_reason: 'withdrawn_by_trustee' });
  });
});

describe('trustee confirmation', () => {
  test('a second trustee must confirm; the reporter cannot', async () => {
    const { owner, client, trustee, link } = await ownerWithTrustee({ canConfirm: true });
    const second = await registerUser();
    await client.post('/api/trustees', { email: second.email, canConfirm: true }).expect(201);
    const inv = (await api(second).get('/api/trustees/invitations').expect(200)).body.invitations[0];
    await api(second).post(`/api/trustees/invitations/${inv.id}/accept`).expect(200);
    await client.patch('/api/me', { requireTrusteeConfirmation: true }).expect(200);
    void link;

    const { activation } = (await api(trustee).post(`/api/trustees/people/${owner.id}/report`, { password: PW }).expect(201)).body;
    await runSchedulerTick(later(49 * HOUR));
    expect((await db.query('SELECT status FROM activations')).rows[0].status).toBe('awaiting_trustee');
    await runSchedulerTick(later(200 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(0);

    const confirmUrl = `/api/trustees/people/${owner.id}/activations/${activation.id}/confirm`;
    await api(trustee).post(confirmUrl, { password: PW }).expect(403);
    clock.set(later(200 * HOUR));
    await api(second).post(confirmUrl, { password: PW }).expect(200);
    await runSchedulerTick(later(213 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(1);
  });

  test('inactivity runs also wait for a trustee when the owner requires it', async () => {
    const { owner, client, trustee } = await ownerWithTrustee({ canConfirm: true }, { inactivityEnabled: true, inactivityDays: 30 });
    await client.patch('/api/me', { requireTrusteeConfirmation: true }).expect(200);
    await runSchedulerTick(later(31 * 24 * HOUR));
    await runSchedulerTick(later(31 * 24 * HOUR + 49 * HOUR));
    const people = (await api(trustee).get('/api/trustees/people').expect(200)).body.people;
    expect(people[0].currentRun).toMatchObject({ source: 'inactivity', status: 'awaiting_trustee', reportedByMe: false });

    clock.set(later(33 * 24 * HOUR));
    await api(trustee).post(`/api/trustees/people/${owner.id}/activations/${people[0].currentRun.id}/confirm`, { password: PW }).expect(200);
    await runSchedulerTick(later(33 * 24 * HOUR + 13 * HOUR));
    expect(sentTo('+14155550111')).toHaveLength(1);
  });
});

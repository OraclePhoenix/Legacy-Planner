const request = require('supertest');
const db = require('../src/db');
const { createApp } = require('../src/app');
const clock = require('../src/utils/clock');
const sms = require('../src/services/sms');

const app = createApp();
let counter = 0;

async function resetDb() {
  await db.migrate();
  await db.query('TRUNCATE users, audit_logs RESTART IDENTITY CASCADE');
  sms.sentInMockMode.length = 0;
  clock.set(null);
}

async function registerUser(overrides = {}) {
  counter += 1;
  const creds = { email: `user${counter}-${Date.now()}@example.com`, name: `User ${counter}`, password: 'correct-horse-1', ...overrides };
  const res = await request(app).post('/api/auth/register').send(creds);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const auth = (req) => req.set('Authorization', `Bearer ${res.body.token}`);
  return { ...creds, id: res.body.user.id, token: res.body.token, auth };
}

const api = (user) => ({
  get: (url) => user.auth(request(app).get(url)),
  post: (url, body) => user.auth(request(app).post(url)).send(body),
  patch: (url, body) => user.auth(request(app).patch(url)).send(body),
  delete: (url) => user.auth(request(app).delete(url)),
});

// A user with one contact on one message, ready to trigger.
async function readyUser(settings = {}) {
  const user = await registerUser();
  const client = api(user);
  await client.patch('/api/me', { phone: '+14155550100', ...settings }).expect(200);
  const contact = (await client.post('/api/contacts', { name: 'Sam', phone: '+14155550111' }).expect(201)).body.contact;
  await client.post('/api/templates', { name: 'Goodbye', body: 'Hi {{name}}, this is my message.', contactIds: [contact.id] }).expect(201);
  return { user, client, contact };
}

module.exports = { app, db, clock, sms, resetDb, registerUser, api, readyUser };

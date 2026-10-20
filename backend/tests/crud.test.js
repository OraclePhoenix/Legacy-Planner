const request = require('supertest');
const { app, db, resetDb, registerUser, api } = require('./helpers');

beforeEach(resetDb);
afterAll(() => db.pool.end());

describe('auth', () => {
  test('rejects weak passwords and wrong credentials', async () => {
    await request(app).post('/api/auth/register').send({ email: 'a@example.com', name: 'A', password: 'short' }).expect(422);
    const user = await registerUser();
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password-1' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: user.email, password: user.password }).expect(200);
  });

  test('protected routes need a token, and a password change signs out old tokens', async () => {
    await request(app).get('/api/contacts').expect(401);
    const user = await registerUser();
    const res = await api(user).post('/api/me/password', { currentPassword: user.password, password: 'new-password-22' }).expect(200);
    await api(user).get('/api/me').expect(401);
    await request(app).get('/api/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
  });
});

describe('checklist', () => {
  test('CRUD, filtering and progress summary', async () => {
    const client = api(await registerUser());
    const a = (await client.post('/api/checklist', { title: 'Write will', category: 'legal', dueDate: '2027-01-01' }).expect(201)).body.item;
    await client.post('/api/checklist', { title: 'List accounts', category: 'financial' }).expect(201);
    await client.post('/api/checklist', { title: 'Bad', category: 'nope' }).expect(422);

    const done = (await client.patch(`/api/checklist/${a.id}`, { status: 'completed' }).expect(200)).body.item;
    expect(done.completedAt).toBeTruthy();
    expect((await client.get('/api/checklist?category=legal').expect(200)).body.items).toHaveLength(1);
    expect((await client.get('/api/checklist/summary').expect(200)).body).toMatchObject({ total: 2, completed: 1 });

    await client.delete(`/api/checklist/${a.id}`).expect(204);
    expect((await client.get('/api/checklist').expect(200)).body.items).toHaveLength(1);
  });

  test('users cannot see or change each other\'s items', async () => {
    const owner = api(await registerUser());
    const other = api(await registerUser());
    const item = (await owner.post('/api/checklist', { title: 'Private' }).expect(201)).body.item;
    expect((await other.get('/api/checklist').expect(200)).body.items).toHaveLength(0);
    await other.patch(`/api/checklist/${item.id}`, { title: 'Hacked' }).expect(404);
    await other.delete(`/api/checklist/${item.id}`).expect(404);
  });
});

describe('contacts', () => {
  test('validates and normalizes phone numbers and encrypts them at rest', async () => {
    const client = api(await registerUser());
    await client.post('/api/contacts', { name: 'X', phone: '12345' }).expect(422);
    const c = (await client.post('/api/contacts', { name: 'Ana', phone: '+44 20 7946 0958', priority: 1 }).expect(201)).body.contact;
    expect(c.phone).toBe('+442079460958');

    const { rows } = await db.query('SELECT name_enc, phone_enc FROM contacts WHERE id = $1', [c.id]);
    expect(rows[0].phone_enc).not.toContain('2079460958');
    expect(rows[0].name_enc).not.toContain('Ana');
  });

  test('imports CSV with per-row errors and exports CSV', async () => {
    const user = await registerUser();
    const csv = 'Name,Phone,Relationship,Priority\nAna,+14155550123,Sister,1\nBen,not-a-phone,Friend,2\n,+14155550124,,\nCal,(415) 555-0125,,3\n';
    const res = await user.auth(request(app).post('/api/contacts/import')).attach('file', Buffer.from(csv), 'c.csv').expect(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.errors.map((e) => e.row)).toEqual([3, 4]);

    const out = await api(user).get('/api/contacts/export').expect(200);
    expect(out.headers['content-type']).toMatch(/text\/csv/);
    expect(out.text).toContain('+14155550125');
    expect(out.text.split('\n')[0]).toBe('name,phone,relationship,priority');
  });
});

describe('templates', () => {
  test('only the owner\'s contacts can be recipients and bodies are encrypted', async () => {
    const owner = api(await registerUser());
    const other = api(await registerUser());
    const theirs = (await other.post('/api/contacts', { name: 'Z', phone: '+14155550199' }).expect(201)).body.contact;
    await owner.post('/api/templates', { name: 'T', body: 'Hello', contactIds: [theirs.id] }).expect(422);

    const t = (await owner.post('/api/templates', { name: 'T', body: 'Secret words', contactIds: [] }).expect(201)).body.template;
    const { rows } = await db.query('SELECT body_enc FROM message_templates WHERE id = $1', [t.id]);
    expect(rows[0].body_enc).not.toContain('Secret');
    expect((await owner.get('/api/templates').expect(200)).body.templates[0].body).toBe('Secret words');
  });
});

describe('audit log', () => {
  test('lists the user\'s own events, newest first, paginated', async () => {
    const client = api(await registerUser());
    await client.patch('/api/me', { name: 'Renamed' }).expect(200);
    const res = await client.get('/api/audit?limit=1').expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.entries[0].action).toBe('user.settings_updated');
  });
});

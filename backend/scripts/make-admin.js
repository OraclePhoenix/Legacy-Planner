// Usage: npm run make-admin -- someone@example.com
const db = require('../src/db');

(async () => {
  const email = (process.argv[2] || '').toLowerCase();
  if (!email) throw new Error('Usage: npm run make-admin -- <email>');
  const { rowCount } = await db.query("UPDATE users SET role = 'admin' WHERE lower(email) = $1", [email]);
  console.log(rowCount ? `${email} is now an admin` : `No user with email ${email}`);
  await db.pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

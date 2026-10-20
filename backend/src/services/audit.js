const db = require('../db');

async function record({ userId, actorId = null, action, details = {}, ip = null }, client = db) {
  await client.query(
    'INSERT INTO audit_logs (user_id, actor_id, action, details, ip) VALUES ($1, $2, $3, $4, $5)',
    [userId, actorId, action, details, ip]
  );
}

module.exports = { record };

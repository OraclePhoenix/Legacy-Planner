const crypto = require('crypto');
const config = require('../config');

const KEY = Buffer.from(config.encryptionKey, 'hex');

// AES-256-GCM. Stored as "v1:<iv>:<tag>:<ciphertext>", all base64.
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const [version, iv, tag, ct] = payload.split(':');
  if (version !== 'v1') throw new Error('Unknown ciphertext version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };

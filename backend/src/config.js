const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

const bool = (value, fallback) => (value === undefined ? fallback : value === 'true');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  encryptionKey: required('ENCRYPTION_KEY'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  defaultPhoneCountry: process.env.DEFAULT_PHONE_COUNTRY || 'US',
  // Master switch: when false the dispatcher never sends, scheduled runs simply wait.
  notificationsEnabled: bool(process.env.NOTIFICATIONS_ENABLED, true),
  // Sign-in/registration attempts per IP per 15 minutes.
  authRateLimit: parseInt(process.env.AUTH_RATE_LIMIT || '20', 10),
  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '60000', 10),
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
  },
};

if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) {
  throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
}
if (config.env === 'production' && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

module.exports = config;

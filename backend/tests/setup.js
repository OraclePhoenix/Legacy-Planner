process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://legacy:legacy@localhost:5432/legacy_test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-tests';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.SCHEDULER_ENABLED = 'false';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.AUTH_RATE_LIMIT = '10000';

const config = require('./config');
const db = require('./db');
const scheduler = require('./services/scheduler');
const sms = require('./services/sms');
const { createApp } = require('./app');

async function main() {
  await db.migrate();
  const server = createApp().listen(config.port, () => {
    console.log(`Legacy Planner API on :${config.port} (SMS ${sms.isLive() ? 'live' : 'mock'} mode, `
      + `notifications ${config.notificationsEnabled ? 'enabled' : 'disabled'})`);
  });
  scheduler.start();

  const shutdown = () => {
    scheduler.stop();
    server.close(() => db.pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

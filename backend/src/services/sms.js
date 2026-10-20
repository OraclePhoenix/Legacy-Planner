const config = require('../config');

let client = null;
const sentInMockMode = [];

const isLive = () => Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber);

function getClient() {
  if (!client) client = require('twilio')(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

// Without Twilio credentials messages are logged, not sent, so development can never text anyone.
async function send(to, body) {
  if (!isLive()) {
    const id = `mock-${Date.now()}-${sentInMockMode.length}`;
    sentInMockMode.push({ id, to, body });
    if (config.env !== 'test') console.log(`[sms:mock] to=${to} body=${JSON.stringify(body)}`);
    return { id };
  }
  const message = await getClient().messages.create({ to, from: config.twilio.fromNumber, body });
  return { id: message.sid };
}

module.exports = { send, isLive, sentInMockMode };

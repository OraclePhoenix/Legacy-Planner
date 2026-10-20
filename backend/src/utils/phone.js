const { parsePhoneNumberFromString } = require('libphonenumber-js');
const config = require('../config');

// Returns the number in E.164 form, or null when it is not a valid number.
function normalizePhone(raw) {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(String(raw).trim(), config.defaultPhoneCountry);
  return parsed && parsed.isValid() ? parsed.number : null;
}

module.exports = { normalizePhone };

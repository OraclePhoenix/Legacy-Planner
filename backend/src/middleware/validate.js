const { validationResult } = require('express-validator');
const HttpError = require('../utils/httpError');

module.exports = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  next(new HttpError(422, 'Validation failed', result.array().map((e) => ({ field: e.path, message: e.msg }))));
};

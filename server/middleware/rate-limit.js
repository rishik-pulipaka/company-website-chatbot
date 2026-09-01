const rateLimit = require('express-rate-limit');

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX = 20; // requests per window per IP

function createPublicApiLimiter(options = {}) {
  const windowMs = typeof options.windowMs === 'number' ? options.windowMs : DEFAULT_WINDOW_MS;
  const max = typeof options.max === 'number' ? options.max : DEFAULT_MAX;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: 'Too many requests, please try again shortly.' });
    }
  });
}

module.exports = { createPublicApiLimiter };

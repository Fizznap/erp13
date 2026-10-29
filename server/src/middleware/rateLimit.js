const rateLimit = require('express-rate-limit');

// General API rate limiter (generous to accommodate campus NAT with many concurrent students)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.API_RATE_LIMIT_MAX ? parseInt(process.env.API_RATE_LIMIT_MAX, 10) : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Dedicated limiter for login endpoints (/api/auth/login, /api/auth/google)
// Separated from general API traffic so legitimate logins are never blocked by data requests
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.LOGIN_RATE_LIMIT_MAX ? parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

// Limiter for registration, email verification, and password reset endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.AUTH_RATE_LIMIT_MAX ? parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// Dedicated token refresh limiter — generous to prevent bulk background refresh lockouts
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.REFRESH_RATE_LIMIT_MAX ? parseInt(process.env.REFRESH_RATE_LIMIT_MAX, 10) : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many session refresh requests, please try again later.' },
});

// RAG query limiter (moderate — AI calls are expensive)
const ragLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many queries, please slow down.' },
});

module.exports = { apiLimiter, loginLimiter, authLimiter, refreshLimiter, ragLimiter };


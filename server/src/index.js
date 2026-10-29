require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();
// Trust reverse proxy:
// In production behind Render (or a single reverse proxy), trust 1 hop to safely
// obtain the client IP from the proxy without blindly trusting arbitrary client-supplied headers.
// Configurable via TRUST_PROXY env variable for custom infrastructure.
const trustProxySetting = process.env.TRUST_PROXY !== undefined
  ? (process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY === 'false' ? false : !isNaN(Number(process.env.TRUST_PROXY)) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY)
  : 1;
app.set('trust proxy', trustProxySetting);
const PORT = process.env.PORT || 3001;

// CORS — support multiple origins for Vercel production + preview URLs
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, health checks)
    if (!origin) return callback(null, true);
    // Exact match from CLIENT_URL list
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow Vercel preview deployments (*.vercel.app)
    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
// Health check (Exempt from rate limits for Render)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health/db', async (req, res) => {
  try {
    const { pool } = require('./db/pool');
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const cols1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
    const cols2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'resources'");
    const cols3 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'attendance_sessions'");
    res.json({
      tables: tables.rows.map(r => r.table_name),
      users_cols: cols1.rows.map(r => r.column_name),
      resources_cols: cols2.rows.map(r => r.column_name),
      attendance_sessions_cols: cols3.rows.map(r => r.column_name),
    });
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// Uploaded files are private; resource downloads use the authorization-checked
// /api/resources/:id/download route. Keep direct filesystem access admin-only.
app.use('/uploads', require('./routes/uploads'));

// Authentication endpoints: Protected by dedicated loginLimiter, authLimiter, and refreshLimiter.
// Mounted BEFORE the general apiLimiter so general API requests (resources, subjects, attendance)
// from other users sharing a campus/NAT IP address never lock out legitimate logins!
app.use('/api/auth', require('./routes/auth'));

// General API rate limiter for data endpoints
app.use('/api', apiLimiter);

// Other API routes
app.use('/api/academic', require('./routes/academic'));
app.use('/api/subjects', require('./routes/subjects'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/ask', require('./routes/ask'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/face', require('./routes/face'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large (max 20MB)' });
  }
  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: 'Internal server error' });
});

// Initialize queue (graceful if Redis unavailable)
try {
  const { initQueue } = require('./jobs/queue');
  initQueue();
} catch (err) {
  console.warn('Queue initialization skipped:', err.message);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │                                         │
  │   Snippet API Server                    │
  │   Running on http://localhost:${PORT}      │
  │                                         │
  │   Routes:                               │
  │   POST   /api/auth/register             │
  │   POST   /api/auth/login                │
  │   GET    /api/subjects                  │
  │   POST   /api/resources/upload          │
  │   POST   /api/ask                       │
  │   POST   /api/attendance/start          │
  │   GET    /api/admin/stats               │
  │   GET    /api/health                    │
  │                                         │
  └─────────────────────────────────────────┘
  `);
});

module.exports = app;

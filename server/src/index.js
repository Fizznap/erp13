require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();
app.set('trust proxy', 1); // Trust Render proxy to fix rate limits
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

app.use('/api', apiLimiter);

// Serve uploaded files (for admin/debug only)
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/academic', require('./routes/academic'));
app.use('/api/subjects', require('./routes/subjects'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/ask', require('./routes/ask'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/admin', require('./routes/admin'));

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

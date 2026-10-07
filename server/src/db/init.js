const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function initDatabase() {
  try {
    console.log('Initializing database...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schema);
    console.log('Database schema created successfully.');

    // Create IVFFlat index for vector search (requires existing data for training)
    // We'll create it as a post-step after initial data is loaded
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chunks_embedding 
        ON resource_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      `);
      console.log('Vector index created.');
    } catch (err) {
      // IVFFlat index creation may fail if no data exists yet — that's fine
      console.log('Vector index deferred (will be created when data exists).');
    }

    process.exit(0);
  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  }
}

initDatabase();

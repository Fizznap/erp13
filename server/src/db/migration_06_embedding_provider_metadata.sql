-- ============================================================
-- Migration 06: Embedding Provider and Model Metadata
-- Enables multi-provider RAG (Gemini and Ollama) and isolates
-- vector spaces to prevent mixing incompatible embedding models.
-- ============================================================

ALTER TABLE resources ADD COLUMN IF NOT EXISTS embedding_provider VARCHAR(50) DEFAULT 'gemini';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100) DEFAULT 'gemini-embedding-2';

ALTER TABLE resource_chunks ADD COLUMN IF NOT EXISTS embedding_provider VARCHAR(50) DEFAULT 'gemini';
ALTER TABLE resource_chunks ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100) DEFAULT 'gemini-embedding-2';

-- Backfill existing rows with initial Gemini defaults
UPDATE resources
SET embedding_provider = 'gemini', embedding_model = 'gemini-embedding-2'
WHERE embedding_provider IS NULL;

UPDATE resource_chunks
SET embedding_provider = 'gemini', embedding_model = 'gemini-embedding-2'
WHERE embedding_provider IS NULL;

CREATE INDEX IF NOT EXISTS idx_chunks_embedding_model ON resource_chunks(embedding_model);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_provider ON resource_chunks(embedding_provider);

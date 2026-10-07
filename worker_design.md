# Worker Design: PDF RAG Processing

## Overview
PDF processing is offloaded to a background worker to ensure fast API responses and scalable ingestion.

**Architecture**: 
- **Queue**: Bull (Redis-backed)
- **Framework**: Node.js microservice or dedicated Express worker process.

## Pipeline Steps
1. **PDF Extractor**
   - Retrieves the raw PDF buffer from S3/local storage.
   - Extracts raw text and page numbers using `pdf-parse`.

2. **Chunker (Semantic Aware)**
   - Target chunk size: **512 tokens**.
   - Overlap: **50 tokens**.
   - Algorithm: Detects paragraph boundaries (`\n\n`) and heuristic headings (ALL CAPS, short lines).
   - **Chunk Metadata Fields stored**:
     - `resource_name`: Original PDF filename.
     - `page_number`: The page where the chunk starts.
     - `heading`: The nearest preceding extracted heading.
     - `chunk_index`: The sequential integer index.
     - `raw_text`: The text content.

3. **Embedder**
   - Calls the embedding provider (e.g. OpenAI `text-embedding-3-small`, Gemini `text-embedding-004`).
   - Retrieves a 768 or 1536 dimensional vector array.
   - **Constraint**: *Precomputed embeddings only.* Never send full PDFs to the LLM at query time.

4. **Store (pgvector)**
   - Inserts the chunk row and vector array into `resource_chunks` table.
   - Updates `resources` table status to `ready`.

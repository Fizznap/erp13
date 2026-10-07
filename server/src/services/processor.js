const fs = require('fs');
const pdf = require('pdf-parse');
const { pool } = require('../db/pool');
const { embedBatch, generateMetadata } = require('./rag');

/**
 * Approximate token count (simple word-based estimate).
 * 1 token ≈ 0.75 words for English text.
 */
function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

/**
 * Chunk text using sliding window strategy.
 * Respects paragraph/sentence boundaries when possible.
 */
function chunkText(text, chunkSizeTokens = 512, overlapTokens = 50) {
  const minChunkTokens = 50;
  const chunks = [];

  // Split into paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  let currentChunk = '';
  let currentTokens = 0;
  let currentHeading = null;

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);
    
    // Heuristic for heading: short paragraph, no ending punctuation
    const isHeading = paragraph.length < 100 && paragraph.length > 4 && !/[.!?:]$/.test(paragraph.trim());
    if (isHeading && currentTokens === 0 && !currentHeading) {
      currentHeading = paragraph.trim();
    }

    // If single paragraph exceeds chunk size, split by sentences
    if (paragraphTokens > chunkSizeTokens) {
      // Flush current chunk
      if (currentChunk.trim()) {
        chunks.push({ content: currentChunk.trim(), heading: currentHeading });
      }
      currentChunk = '';
      currentTokens = 0;
      if (isHeading) currentHeading = paragraph.trim();

      // Split large paragraph by sentences
      const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) || [paragraph];
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (currentTokens + sentenceTokens > chunkSizeTokens && currentChunk.trim()) {
          chunks.push({ content: currentChunk.trim(), heading: currentHeading });
          // Keep overlap from end of previous chunk
          const words = currentChunk.trim().split(/\s+/);
          const overlapWords = Math.round(overlapTokens * 0.75);
          currentChunk = words.slice(-overlapWords).join(' ') + ' ';
          currentTokens = overlapTokens;
        }
        currentChunk += sentence;
        currentTokens += sentenceTokens;
      }
      continue;
    }

    // If adding this paragraph exceeds chunk size, flush and start new
    if (currentTokens + paragraphTokens > chunkSizeTokens && currentChunk.trim()) {
      chunks.push({ content: currentChunk.trim(), heading: currentHeading });
      // Keep overlap
      const words = currentChunk.trim().split(/\s+/);
      const overlapWords = Math.round(overlapTokens * 0.75);
      currentChunk = words.slice(-overlapWords).join(' ') + '\n\n';
      currentTokens = overlapTokens;
      if (isHeading) currentHeading = paragraph.trim();
    }

    currentChunk += paragraph + '\n\n';
    currentTokens += paragraphTokens;
  }

  // Flush remaining
  if (currentChunk.trim() && estimateTokens(currentChunk) >= minChunkTokens) {
    chunks.push({ content: currentChunk.trim(), heading: currentHeading });
  }

  return chunks;
}

/**
 * Process a resource end-to-end:
 * 1. Extract text from PDF
 * 2. Chunk the text
 * 3. Embed all chunks (batch)
 * 4. Generate metadata (summary, topics, bullets)
 * 5. Update resource status
 */
async function processResource(resourceId) {
  console.log(`[Processor] Starting processing for resource ${resourceId}`);

  try {
    // Update status to processing
    await pool.query(
      "UPDATE resources SET status = 'processing' WHERE id = $1",
      [resourceId]
    );

    // Get resource info
    const resourceResult = await pool.query('SELECT * FROM resources WHERE id = $1', [resourceId]);
    if (resourceResult.rows.length === 0) {
      throw new Error('Resource not found');
    }
    const resource = resourceResult.rows[0];

    // Step 1: Extract text from PDF
    console.log(`[Processor] Extracting text from ${resource.original_name}...`);
    const pdfBuffer = fs.readFileSync(resource.file_path);
    const pdfData = await pdf(pdfBuffer);
    const rawText = pdfData.text;
    const pageCount = pdfData.numpages;

    if (!rawText || rawText.trim().length < 50) {
      throw new Error('PDF contains too little text to process');
    }

    // Step 2: Chunk the text
    console.log(`[Processor] Chunking text (${rawText.length} chars)...`);
    const chunkSizeTokens = parseInt(process.env.CHUNK_SIZE_TOKENS) || 512;
    const overlapTokens = parseInt(process.env.CHUNK_OVERLAP_TOKENS) || 50;
    const textChunks = chunkText(rawText, chunkSizeTokens, overlapTokens);
    console.log(`[Processor] Created ${textChunks.length} chunks`);

    if (textChunks.length === 0) {
      throw new Error('No valid chunks could be created from the PDF');
    }

    // Step 3: Embed chunks in batches of 100
    console.log(`[Processor] Embedding ${textChunks.length} chunks...`);
    const allEmbeddings = [];
    const batchSize = 100;

    for (let i = 0; i < textChunks.length; i += batchSize) {
      const batch = textChunks.slice(i, i + batchSize).map(c => c.content);
      const embeddings = await embedBatch(batch);
      allEmbeddings.push(...embeddings);
      console.log(`[Processor] Embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(textChunks.length / batchSize)}`);
    }

    // Step 4: Store chunks + embeddings
    console.log(`[Processor] Storing chunks in database...`);
    // Delete any existing chunks for this resource (in case of reprocessing)
    await pool.query('DELETE FROM resource_chunks WHERE resource_id = $1', [resourceId]);

    // Estimate page numbers based on chunk position
    const charsPerPage = Math.ceil(rawText.length / Math.max(pageCount, 1));

    for (let i = 0; i < textChunks.length; i++) {
      const chunkObj = textChunks[i];
      const chunkContent = chunkObj.content;
      const embedding = allEmbeddings[i];
      const tokenCount = estimateTokens(chunkContent);
      // Rough page estimate
      const charPosition = rawText.indexOf(chunkContent.substring(0, 50));
      const pageNumber = Math.max(1, Math.ceil((charPosition >= 0 ? charPosition : 0) / charsPerPage));

      const vectorStr = `[${embedding.join(',')}]`;
      await pool.query(
        `INSERT INTO resource_chunks (resource_id, chunk_index, content, token_count, page_number, heading, resource_name, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
        [resourceId, i, chunkContent, tokenCount, pageNumber, chunkObj.heading, resource.original_name, vectorStr]
      );
    }

    // Step 5: Generate metadata
    console.log(`[Processor] Generating metadata...`);
    let metadata = { summary: '', keyTopics: [], bulletPoints: [] };
    try {
      const chunkObjs = textChunks.slice(0, 5).map((c) => ({ content: c.content }));
      metadata = await generateMetadata(chunkObjs);
    } catch (metaErr) {
      console.warn('[Processor] Metadata generation failed (non-fatal):', metaErr.message);
      metadata = {
        summary: `Document "${resource.original_name}" with ${pageCount} pages and ${textChunks.length} content sections.`,
        keyTopics: [],
        bulletPoints: [],
      };
    }

    // Step 6: Update resource as ready
    await pool.query(
      `UPDATE resources SET
        status = 'ready',
        summary = $1,
        key_topics = $2,
        bullet_points = $3,
        page_count = $4,
        chunk_count = $5,
        processed_at = now()
       WHERE id = $6`,
      [
        metadata.summary,
        JSON.stringify(metadata.keyTopics || []),
        JSON.stringify(metadata.bulletPoints || []),
        pageCount,
        textChunks.length,
        resourceId,
      ]
    );

    console.log(`[Processor] Resource ${resourceId} processed successfully (${textChunks.length} chunks)`);
    return { success: true, chunkCount: textChunks.length };
  } catch (err) {
    console.error(`[Processor] Failed to process resource ${resourceId}:`, err);
    await pool.query(
      "UPDATE resources SET status = 'failed', error_message = $1 WHERE id = $2",
      [err.message, resourceId]
    );
    throw err;
  }
}

module.exports = { processResource, chunkText, estimateTokens };

const { pool } = require('../db/pool');
const { getEmbeddingProvider } = require('./providers');

/**
 * Re-embed a resource in a controlled, non-destructive way.
 * Preserves the resource, its metadata, and all existing records while
 * regenerating vectors using the specified embedding provider/model.
 *
 * @param {string} resourceId - UUID of the resource to re-embed
 * @param {string} [targetProviderName] - 'ollama' or 'gemini' (defaults to active provider)
 * @returns {Promise<{ success: boolean, chunkCount: number, provider: string, model: string }>}
 */
async function reembedResource(resourceId, targetProviderName) {
  const provider = getEmbeddingProvider(targetProviderName);
  const expectedDimensions = provider.dimensions || 768;

  const resourceRes = await pool.query('SELECT * FROM resources WHERE id = $1', [resourceId]);
  if (resourceRes.rows.length === 0) {
    throw new Error(`Resource '${resourceId}' not found.`);
  }
  const resource = resourceRes.rows[0];

  const chunksRes = await pool.query(
    'SELECT id, chunk_index, content FROM resource_chunks WHERE resource_id = $1 ORDER BY chunk_index ASC',
    [resourceId]
  );

  if (chunksRes.rows.length === 0) {
    throw new Error(`No existing chunks found for resource '${resourceId}'.`);
  }

  const chunks = chunksRes.rows;
  const texts = chunks.map((c) => c.content);

  console.log(`[ReEmbed] Re-embedding ${texts.length} chunks for '${resource.original_name}' using ${provider.name} (${provider.model})...`);

  // Batch embed in chunks of 100
  const allEmbeddings = [];
  const batchSize = 100;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await provider.embedBatch(batch);
    if (!Array.isArray(embeddings) || embeddings.length !== batch.length ||
        embeddings.some((e) => !Array.isArray(e) || e.length !== expectedDimensions || e.some((v) => !Number.isFinite(v)))) {
      throw new Error(`Provider '${provider.name}' returned invalid vectors for batch.`);
    }
    allEmbeddings.push(...embeddings);
  }

  // Update resource_chunks inside a transaction to ensure atomic transition
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = chunks[i].id;
      const vectorStr = `[${allEmbeddings[i].join(',')}]`;
      await client.query(
        `UPDATE resource_chunks
         SET embedding = $1::vector,
             embedding_provider = $2,
             embedding_model = $3
         WHERE id = $4`,
        [vectorStr, provider.name, provider.model, chunkId]
      );
    }

    await client.query(
      `UPDATE resources
       SET embedding_provider = $1,
           embedding_model = $2
       WHERE id = $3`,
      [provider.name, provider.model, resourceId]
    );

    await client.query('COMMIT');
    console.log(`[ReEmbed] Successfully re-embedded resource '${resourceId}' with ${provider.name} (${provider.model}).`);
    return {
      success: true,
      chunkCount: chunks.length,
      provider: provider.name,
      model: provider.model,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { reembedResource };

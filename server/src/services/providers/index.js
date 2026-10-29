const { GeminiProvider } = require('./geminiProvider');
const { OllamaProvider, EXPECTED_EMBEDDING_DIMENSIONS } = require('./ollamaProvider');

let cachedGeminiProvider = null;
let cachedOllamaProvider = null;

function getGeminiInstance() {
  if (!cachedGeminiProvider) {
    cachedGeminiProvider = new GeminiProvider();
  }
  return cachedGeminiProvider;
}

function getOllamaInstance() {
  if (!cachedOllamaProvider) {
    cachedOllamaProvider = new OllamaProvider();
  }
  return cachedOllamaProvider;
}

/**
 * Resolve the active embedding provider name from environment or defaults.
 * Explicit EMBEDDING_PROVIDER takes precedence.
 * Falls back to 'gemini' if GOOGLE_AI_API_KEY is present, otherwise 'ollama'.
 */
function resolveEmbeddingProviderName(override) {
  if (override) return override.toLowerCase();
  const envVal = process.env.EMBEDDING_PROVIDER;
  if (envVal) {
    const norm = envVal.trim().toLowerCase();
    return norm === 'google' ? 'gemini' : norm;
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    return 'gemini';
  }
  return 'ollama';
}

/**
 * Resolve the active generation provider name from environment or defaults.
 * Explicit LLM_PROVIDER or GENERATION_PROVIDER takes precedence.
 */
function resolveGenerationProviderName(override) {
  if (override) return override.toLowerCase();
  const envVal = process.env.LLM_PROVIDER || process.env.GENERATION_PROVIDER;
  if (envVal) {
    const norm = envVal.trim().toLowerCase();
    return norm === 'gemini' ? 'google' : norm;
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    return 'google';
  }
  return 'ollama';
}

/**
 * Get the requested or active embedding provider instance.
 */
function getEmbeddingProvider(nameOverride) {
  const providerName = resolveEmbeddingProviderName(nameOverride);
  switch (providerName) {
    case 'gemini':
    case 'google':
      return getGeminiInstance();
    case 'ollama':
      return getOllamaInstance();
    default:
      throw new Error(`Unsupported embedding provider: '${providerName}'. Supported: 'gemini', 'ollama'.`);
  }
}

/**
 * Get the requested or active generation provider instance.
 */
function getGenerationProvider(nameOverride) {
  const providerName = resolveGenerationProviderName(nameOverride);
  switch (providerName) {
    case 'gemini':
    case 'google':
      return getGeminiInstance();
    case 'ollama':
      return getOllamaInstance();
    default:
      // Other generation providers (e.g. openai, mock) handled by llmAdapter
      return null;
  }
}

module.exports = {
  getEmbeddingProvider,
  getGenerationProvider,
  resolveEmbeddingProviderName,
  resolveGenerationProviderName,
  GeminiProvider,
  OllamaProvider,
  EXPECTED_EMBEDDING_DIMENSIONS,
};

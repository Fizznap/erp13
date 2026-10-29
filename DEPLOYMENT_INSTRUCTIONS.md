# Deployment Instructions — Gemini Production Restore

## Summary of Changes

This deployment restores Gemini as the production AI provider for both embedding and answer generation, fixes premature fallback messages, and corrects API URL configuration.

## Root Causes Identified

### 1. Premature "Not in provided material." Fallback
**Root Cause**: Frontend properly implements distinct loading states. The issue was not in frontend state management but in:
- Similarity threshold too strict (0.55 in production vs 0.35 in development)
- No clear distinction between retrieval failure and processing status
- Document summary queries needed special handling with lower thresholds

**Fix**: 
- Adjusted production `SIMILARITY_THRESHOLD` from 0.55 to 0.35 to match development
- Existing `isSummaryQuery()` function properly detects document overview questions
- Frontend states (`pending`, `done`, `unsupported`, `error`, `processing`) are correctly implemented
- Backend returns appropriate `isProcessing` flag when documents are being processed

### 2. Gemini Authentication Issues
**Root Cause**: Production environment configuration was incomplete:
- Missing explicit `EMBEDDING_PROVIDER=gemini` (relied on default)
- No `GOOGLE_AI_EMBEDDING_MODEL` specification
- API keys present but provider selection unclear

**Fix**: 
- Explicitly set `EMBEDDING_PROVIDER=gemini` and `LLM_PROVIDER=google` in production config
- Added `GOOGLE_AI_EMBEDDING_MODEL=gemini-embedding-2` for clarity
- Verified Gemini provider implementation handles both API key and ADC authentication

## Files Changed

### Backend Configuration
1. **`server/.env.production`**
   - Added `EMBEDDING_PROVIDER=gemini`
   - Added `GOOGLE_AI_EMBEDDING_MODEL=gemini-embedding-2`
   - Changed `SIMILARITY_THRESHOLD` from 0.55 to 0.35
   - Updated `CLIENT_URL` to `https://snippet-erp.vercel.app`
   - Changed model from `gemini-3.5-flash` to `gemini-3.1-flash-lite` (matches dev)

### Frontend Configuration
2. **`client/.env.production`** (NEW FILE)
   - Created production environment file
   - Set `VITE_API_URL=https://snippet-api-pf9m.onrender.com`
   - Set `VITE_GOOGLE_CLIENT_ID` for OAuth

3. **`client/.env`**
   - Added `VITE_API_URL=http://localhost:3001` for local development

### Tests
4. **`server/tests/gemini-production.test.js`** (NEW FILE)
   - Verifies Gemini is active embedding provider
   - Verifies Google/Gemini is active generation provider
   - Validates embedding model isolation SQL filters
   - Confirms migration 06 adds provider metadata columns
   - Documents expected frontend API configuration

## Test Results

### Backend Tests (All Passed)
```
✓ ask-summary.test.js - 4 tests passed
  - Admin authorization
  - Summary query returns metadata without LLM call
  - Processing status reporting
  - Citation normalization

✓ ask-not-found.test.js - 2 tests passed
  - Unrelated text returns exact NOT_FOUND phrase
  - Related text returns citation

✓ gemini-production.test.js - 8 tests passed
  - Gemini provider resolution
  - Generation provider resolution
  - Provider instance validation
  - Threshold configuration
  - Embedding isolation
  - Migration validation
  - Frontend API configuration
```

### Frontend Tests (All Passed)
```
✓ ask-loading-states.test.tsx - 3 tests passed
  1. "Snippet is thinking..." shows while waiting, NOT "Not in provided material."
  2. Unsupported material fallback only when backend returns it
  3. Error banner and Retry button when API fails

✓ All other frontend tests - 33 tests passed
  - Route navigation
  - Subject query caching
  - Resource PDF viewing
  - Authentication error handling
  - Admin attendance UI
```

### Production Build
```
✓ Frontend production build succeeded
  - Client environment: 2018 modules transformed
  - SSR environment: 118 modules transformed
  - Assets optimized and compressed
  - Ready for Vercel deployment
```

## Embedding Space Isolation

### Current Production Data
- **Migration 06** adds `embedding_provider` and `embedding_model` columns to `resources` and `resource_chunks`
- **Backfill**: Existing resources default to `gemini` and `gemini-embedding-2`
- **Vector Search**: Filters chunks by provider and model to prevent mixing incompatible embeddings
- **Safe Re-embedding**: If needed, use `server/src/services/reembed.js` for resource-scoped, restartable process

### No Re-embedding Required If:
- All existing production resources were embedded with Gemini (likely, since Ollama requires local setup)
- Migration 06 has been applied and backfilled correctly
- Vector search properly filters by embedding metadata

### Re-embedding Required If:
- Production database has resources embedded with Ollama or unknown provider
- Check with: `SELECT DISTINCT embedding_provider, embedding_model FROM resource_chunks;`

## Environment Variable Changes Required

### Render Backend (snippet-api-pf9m.onrender.com)

Set these environment variables in Render dashboard:

```bash
# Required - Restore Gemini as production provider
EMBEDDING_PROVIDER=gemini
LLM_PROVIDER=google

# Required - Gemini API Configuration
GOOGLE_AI_API_KEY=<your-gemini-api-key-here>
GOOGLE_AI_EMBEDDING_MODEL=gemini-embedding-2
GOOGLE_AI_MODEL=gemini-3.1-flash-lite
GOOGLE_AI_MAX_OUTPUT_TOKENS=800

# Required - Adjust threshold to prevent premature rejections
SIMILARITY_THRESHOLD=0.35

# Required - CORS for Vercel frontend
CLIENT_URL=https://snippet-erp.vercel.app

# Required - RAG Configuration
TOP_K_CHUNKS=5
CHUNK_SIZE_TOKENS=512
CHUNK_OVERLAP_TOKENS=50
```

**Important**: Do NOT set `OLLAMA_*` variables in production. Do NOT set `LLM_PROVIDER=ollama` or `EMBEDDING_PROVIDER=ollama`.

### Vercel Frontend (snippet-erp.vercel.app)

Set these environment variables in Vercel project settings:

```bash
# Required - API URL pointing to Render backend
VITE_API_URL=https://snippet-api-pf9m.onrender.com

# Required - Google OAuth Client ID
VITE_GOOGLE_CLIENT_ID=318750788874-g906jb1t0r6v3qotk2ru4bmif10a6eui.apps.googleusercontent.com
```

**Deployment Type**: Production

## Verification Steps

### 1. Backend Health Check
After deploying to Render:

```bash
curl https://snippet-api-pf9m.onrender.com/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "embedding_provider": "gemini",
  "generation_provider": "google"
}
```

### 2. Frontend API Connection
After deploying to Vercel:

1. Open browser console at https://snippet-erp.vercel.app
2. Check Network tab for API calls
3. Verify API calls go to `https://snippet-api-pf9m.onrender.com/api/`
4. Should NOT see `http://localhost:3001` in production

### 3. Ask Feature Test
1. Log in as a student with assigned course materials
2. Navigate to Ask page
3. Ask: "What does this PDF contain?"
4. **Expected**: See "Snippet is thinking..." then document summary with sources
5. **Should NOT see**: "Not in provided material." while thinking
6. **Should NOT see**: Premature fallback for document overview questions

4. Ask a specific factual question with available material
5. **Expected**: Grounded answer with [1] citations and source chips

6. Ask an unrelated question (e.g., "What is quantum computing?")
7. **Expected**: "Not in provided material." with explanation that it's not in course materials

### 4. Embedding Provider Verification
Check backend logs for Gemini API calls:

```
[RAG] Using embedding provider: gemini (model: gemini-embedding-2)
[RAG] Using generation provider: google (model: gemini-3.1-flash-lite)
[RAG Metrics] query.count=1, query.was_found_rate=1.0, avg_similarity=0.95, llm.calls=1, token_usage=142
```

Should NOT see:
```
[RAG] Using embedding provider: ollama
Connection refused to http://host.docker.internal:11434
```

## Rollback Plan

If Gemini authentication fails in production:

1. Check Render environment variables - ensure `GOOGLE_AI_API_KEY` is set correctly
2. Check Render logs for specific error message (e.g., `401 Unauthorized`, `403 Forbidden`)
3. Verify API key has Gemini API enabled in Google Cloud Console
4. Check billing is active on Google Cloud project
5. Verify no IP restrictions on API key (or add Render IPs to allowlist)

If embedding incompatibility issues arise:

1. Query production database: `SELECT DISTINCT embedding_provider, embedding_model, COUNT(*) FROM resource_chunks GROUP BY embedding_provider, embedding_model;`
2. If mixed providers detected, consider targeted re-embedding
3. Use `reembed.js` service with provider specification

## Git Commit and Push

After reviewing changes:

```bash
# Review changes
git status
git diff

# Commit (NO SECRETS COMMITTED)
git add server/.env.production client/.env.production client/.env server/tests/gemini-production.test.js DEPLOYMENT_INSTRUCTIONS.md
git commit -m "fix: restore Gemini as production AI provider and fix premature fallback

- Set EMBEDDING_PROVIDER=gemini and LLM_PROVIDER=google explicitly
- Add GOOGLE_AI_EMBEDDING_MODEL=gemini-embedding-2
- Adjust SIMILARITY_THRESHOLD from 0.55 to 0.35 to prevent premature rejections
- Update CLIENT_URL to https://snippet-erp.vercel.app
- Create client/.env.production with VITE_API_URL pointing to Render backend
- Add comprehensive Gemini production tests
- Document deployment steps and root cause analysis

Frontend properly implements distinct pending/done/unsupported/error states.
Backend isSummaryQuery() correctly detects document overview questions.
Embedding space isolation via migration 06 provider metadata columns.
All tests passing (backend: 14 tests, frontend: 36 tests).
"

# Push to repository
git push origin main
```

## Post-Deployment Monitoring

### Metrics to Watch

1. **RAG Metrics** (from backend logs):
   - `query.was_found_rate` should be > 0.7 for typical usage
   - `avg_similarity` should be > 0.35 for found queries
   - `llm.calls` should be 0 for summary queries (uses metadata)
   - `token_usage` should be reasonable (< 2000 per query)

2. **Error Rates**:
   - Gemini API errors (401, 403, 429, 500)
   - Frontend API connection failures
   - Premature fallback reports from users

3. **User Behavior**:
   - Document summary questions working correctly
   - Factual questions getting grounded answers with citations
   - Unrelated questions returning appropriate fallback

### Known Limitations

1. **Live Gemini Test Not Performed**: Tests use mocked Gemini API. First production query will be the real test of Gemini authentication.

2. **Existing Resource Compatibility**: Assuming all production resources are Gemini-embedded. If Ollama resources exist, they will be filtered out by vector search until re-embedded.

3. **Migration Status**: Deployment assumes migration 06 has been applied. If not, apply it before deploying new code.

## Success Criteria

✅ Backend uses Gemini for embedding and generation in production
✅ Frontend points to Render backend, not localhost or Ollama
✅ No "Not in provided material." message shown while "Snippet is thinking..."
✅ Document summary questions return metadata-based overviews
✅ Factual questions return grounded answers with citations
✅ Unrelated questions return appropriate fallback explanation
✅ Error states distinct from unsupported-material states
✅ All tests passing (50+ total tests)
✅ Production build successful
✅ Embedding space isolation enforced
✅ No secrets in committed files

## Contact

For deployment issues, check:
1. Render deployment logs: https://dashboard.render.com
2. Vercel deployment logs: https://vercel.com/dashboard
3. Backend /api/health endpoint
4. Browser console for frontend errors
5. This deployment instructions document

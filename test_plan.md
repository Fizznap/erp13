# Security & Test Plan

## Security & Privacy Checklist
- [x] **No Raw Face Storage**: Ensure FaceMatchAdapter only stores one-way embeddings.
- [x] **Audit Logging**: `ai_audit_logs` tracks `prompt_hash`, `was_found`, `similarity_score`, `response_time_ms`, and `provider`.
- [x] **Threshold Config**: Ensure `SIMILARITY_THRESHOLD` is set via environment variable.
- [x] **Rate Limits**: Apply express-rate-limit to `/ask` and `/attendance/mark`.
- [x] **Spoofing**: GPS coords are verified purely server-side via Haversine distance, with hashes stored in DB.

## Testing Procedures

### 1. RAG Fast-Fail Validation
- **Setup**: Upload a PDF about "Quantum Physics".
- **Action**: Query `/ask` with "How to bake a cake?".
- **Expectation**: Vector search returns low cosine similarity (e.g. `0.20`). The route logic intercepts because `0.20 < 0.55`.
- **Assertion**: Server immediately returns exact string `"Not in provided material."`. LLM API is never called (verified via mock/spy).

### 2. Attendance Distance Checks
- **Setup**: Create an attendance session at `Lat: 40.7128`, `Long: -74.0060` (Radius: 50m).
- **Action**: Fire a POST request simulating a student at `Lat: 40.7130`, `Long: -74.0060` (approx 22 meters away).
- **Expectation**: Server accepts and marks `present`.
- **Action 2**: Fire POST request at `Lat: 40.7140`, `Long: -74.0060` (approx 130 meters away).
- **Expectation**: Server rejects with 400 error. Record logged as `rejected`.

### 3. Face Adapter Mock Tests
- **Setup**: Instantiate a Mock `FaceMatchAdapter` that always returns `0.95` for valid hashes.
- **Action**: Call `compareFaces` with a dummy image and hash.
- **Assertion**: Verifies interface boundaries are respected and the mocked confidence score handles the boolean `match: true` criteria correctly.

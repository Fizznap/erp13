# Minimal Face-Match Adapter Interface Spec (Phase 2)

## Overview
This defines the interface and payload structure for the optional Phase 2 Face-ID feature. 
**Privacy Rule**: NEVER store raw images. Store only encrypted/hashed embeddings.

## 1. Adapter Interface (Node/TS)

```typescript
export interface FaceMatchResult {
  match: boolean;
  confidence: number;
  error?: string;
}

export interface FaceMatchAdapter {
  /**
   * Compares an incoming face image against a stored reference embedding.
   * @param incomingBase64 Base64 encoded JPEG/PNG of the live camera feed
   * @param referenceHash Hashed or encrypted embedding stored in DB
   */
  compareFaces(incomingBase64: string, referenceHash: string): Promise<FaceMatchResult>;
}
```

## 2. API Contract (POST `/api/face/match`)

**Request:**
```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQ...",
  "deviceId": "device-uuid-1234"
}
```

**Response (Success):**
```json
{
  "match": true,
  "confidence": 0.985
}
```

## 3. Integration & Fallback
- If the `confidence` score falls below the threshold (e.g. `0.90`), return `match: false`.
- If Face-ID fails 3 times, fallback to GPS + manual faculty override.

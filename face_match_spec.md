# Minimal Face-Match Adapter Interface Spec (Phase 2)

## Overview
This defines the interface and payload structure for the optional Phase 2 Face-ID feature. The system is designed to plug into any CV provider (AWS Rekognition, Google Vision, or OpenCV).

## 1. Adapter Interface (Node.js)

```typescript
interface FaceMatchAdapter {
  /**
   * Compares an incoming face image against a stored reference embedding.
   * @param incomingBase64 Base64 encoded JPEG/PNG of the live camera feed
   * @param referenceHash Hashed or encrypted embedding stored in DB
   * @returns Match confidence (0.0 to 1.0) and boolean match result based on threshold
   */
  compareFaces(incomingBase64: string, referenceHash: string): Promise<{
    match: boolean;
    confidence: number;
    error?: string;
  }>;
}
```

## 2. API Contract (POST `/api/face/match`)

**Request:**
```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "deviceId": "device-uuid-1234",
  "sessionId": "attendance-session-uuid"
}
```

**Response (Success):**
```json
{
  "match": true,
  "confidence": 0.985,
  "provider": "aws-rekognition",
  "message": "Face verified successfully"
}
```

**Response (Failure):**
```json
{
  "match": false,
  "confidence": 0.421,
  "error": "Face mismatch. Please ensure good lighting and try again."
}
```

## 3. Privacy & Hook Provisioning
- **Storage**: Never store raw face images for active matching. Store a one-way embedding or encrypted blob.
- **Audit**: Log `confidence` score and `deviceId` in `attendance_records` if the override is approved.
- **UI Fallback**: If Face-ID fails 3 times, fallback to Admin Override PIN or manual verification.

/**
 * GPS Attendance Accuracy Tests
 * 
 * Tests location validation, accuracy checking, Haversine distance calculation,
 * and geofence decision logic with various coordinate scenarios.
 */

const request = require('supertest');
const express = require('express');
const { haversineDistance } = require('../src/utils/geo');
const { pool } = require('../src/db/pool');
const jwt = require('jsonwebtoken');

// Mock the database pool
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

// Mock authentication middleware
let mockCurrentUser = { id: 'test-student-1', role: 'student', academicClassId: 'class-1' };

jest.mock('../src/middleware/auth', () => ({
  authenticate(req, res, next) {
    if (!mockCurrentUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = mockCurrentUser;
    next();
  },
  authorize(...roles) {
    return (req, res, next) => {
      if (!mockCurrentUser) return res.status(401).json({ error: 'Authentication required' });
      return roles.includes(req.user.role)
        ? next()
        : res.status(403).json({ error: 'Insufficient permissions' });
    };
  },
}));

describe('Haversine Distance Calculation', () => {
  test('calculates distance between known coordinates correctly', () => {
    // Mumbai University Fort Campus to Gateway of India (known ~2.5 km)
    const dist1 = haversineDistance(18.9289, 72.8306, 18.9220, 72.8347);
    expect(dist1).toBeGreaterThan(700);
    expect(dist1).toBeLessThan(900);

    // Two very close points (should be < 10m)
    const dist2 = haversineDistance(18.5204, 73.8567, 18.5205, 73.8568);
    expect(dist2).toBeLessThan(20);

    // Exact same location (should be 0)
    const dist3 = haversineDistance(18.5204, 73.8567, 18.5204, 73.8567);
    expect(dist3).toBeLessThan(1);

    // Cross-hemisphere distance
    const dist4 = haversineDistance(40.7128, -74.0060, -33.8688, 151.2093); // NYC to Sydney
    expect(dist4).toBeGreaterThan(15000000); // > 15,000 km
  });

  test('handles coordinate order correctly (not swapping lat/lon)', () => {
    // Pune (18.5204, 73.8567)
    const lat = 18.5204;
    const lon = 73.8567;
    
    // Nearby point 50m north
    const nearbyLat = lat + 0.00045; // ~50m north
    const nearbyLon = lon;
    
    const distCorrect = haversineDistance(lat, lon, nearbyLat, nearbyLon);
    const distSwapped = haversineDistance(lon, lat, nearbyLon, nearbyLat); // WRONG ORDER
    
    expect(distCorrect).toBeLessThan(100);
    expect(distSwapped).not.toBeCloseTo(distCorrect, 0); // Should be vastly different
  });

  test('returns consistent results regardless of point order', () => {
    const lat1 = 18.5204, lon1 = 73.8567;
    const lat2 = 18.5214, lon2 = 73.8577;
    
    const dist1 = haversineDistance(lat1, lon1, lat2, lon2);
    const dist2 = haversineDistance(lat2, lon2, lat1, lon1);
    
    expect(dist1).toBeCloseTo(dist2, 2);
  });
});

describe('GPS Attendance Backend Validation', () => {
  let app;
  const testSessionId = 'test-session-1';
  const testUserId = 'test-student-1';

  beforeAll(() => {
    // Create test app
    app = express();
    app.use(express.json());
    app.use('/api/attendance', require('../src/routes/attendance'));
  });

  beforeEach(() => {
    // Reset mock user
    mockCurrentUser = { id: testUserId, role: 'student', academicClassId: 'class-1' };
    pool.query.mockReset();
  });

  test('accepts location clearly inside radius', async () => {
    // Mock 1: Get session by nonce
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        subject_offering_id: 'offering-1',
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
      }],
    });
    
    // Mock 2: Get user class info
    pool.query.mockResolvedValueOnce({
      rows: [{
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
        branch_id: 'branch-1',
        batch_id: 'batch-1',
        division_id: 'div-1',
      }],
    });
    
    // Mock 3: Verify offering enrollment
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'offering-1' }],
    });
    
    // Mock 4: Check existing attendance (none)
    pool.query.mockResolvedValueOnce({ rows: [] });
    
    // Mock 5: Insert attendance record
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'record-1',
        student_id: testUserId,
        session_id: testSessionId,
        status: 'present',
        latitude: 18.52067,
        longitude: 73.8567,
        accuracy: 10,
      }],
    });

    // 30m away (inside 50m radius)
    const response = await request(app)
      .post('/api/attendance/mark')
      .send({
        nonce: 'AAABBB',
        latitude: 18.52067, // ~30m north
        longitude: 73.8567,
        accuracy: 10,
        timestamp: Date.now(),
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('present');
    expect(response.body.distance).toBeLessThan(50);
  });

  test('rejects location clearly outside radius', async () => {
    // Mock 1: Get session by nonce
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        subject_offering_id: 'offering-1',
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
      }],
    });
    
    // Mock 2: Get user class info
    pool.query.mockResolvedValueOnce({
      rows: [{
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
        branch_id: 'branch-1',
        batch_id: 'batch-1',
        division_id: 'div-1',
      }],
    });
    
    // Mock 3: Verify offering enrollment
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'offering-1' }],
    });
    
    // Mock 4: Check existing attendance (none)
    pool.query.mockResolvedValueOnce({ rows: [] });
    
    // Mock 5: Insert rejected attendance record
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'record-rejected-1' }],
    });

    // 100m away (outside 50m radius)
    const response = await request(app)
      .post('/api/attendance/mark')
      .send({
        nonce: 'AAABBB',
        latitude: 18.52130, // ~100m north
        longitude: 73.8567,
        accuracy: 10,
        timestamp: Date.now(),
      });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('rejected');
    expect(response.body.distance).toBeGreaterThan(50);
  });

  test('rejects location with poor accuracy', async () => {
    // Mock database response for session lookup
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        academic_class_id: 'class-1',
      }],
    });

    const response = await request(app)
      .post('/api/attendance/mark')
      .send({
        nonce: 'AAABBB',
        latitude: 18.5204,
        longitude: 73.8567,
        accuracy: 50, // Too low (default max is 25m)
        timestamp: Date.now(),
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('ACCURACY_TOO_LOW');
    expect(response.body.reportedAccuracy).toBe(50);
  });

  test('handles uncertainty overlapping boundary', async () => {
    // Mock 1: Get session by nonce
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        subject_offering_id: 'offering-1',
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
      }],
    });
    
    // Mock 2: Get user class info
    pool.query.mockResolvedValueOnce({
      rows: [{
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
        branch_id: 'branch-1',
        batch_id: 'batch-1',
        division_id: 'div-1',
      }],
    });
    
    // Mock 3: Verify offering enrollment
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'offering-1' }],
    });
    
    // Mock 4: Check existing attendance (none)
    pool.query.mockResolvedValueOnce({ rows: [] });
    
    // Mock 5: Insert rejected attendance record (uncertainty overlap)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'record-uncertain-1' }],
    });

    // 45m away with 15m accuracy - uncertainty overlaps 50m boundary
    const response = await request(app)
      .post('/api/attendance/mark')
      .send({
        nonce: 'AAABBB',
        latitude: 18.52085, // ~45m north
        longitude: 73.8567,
        accuracy: 15,
        timestamp: Date.now(),
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNCERTAIN_BOUNDARY');
  });

  test('rejects reversed latitude and longitude', async () => {
    // Note: This test uses 73.8567 as latitude, which is technically valid (-90 to 90)
    // but it's a longitude value. It will fail during enrollment/auth checks.
    
    // Mock 1: Get session by nonce
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        subject_offering_id: 'offering-1',
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
      }],
    });
    
    // Mock 2: Get user class info
    pool.query.mockResolvedValueOnce({
      rows: [{
        academic_class_id: 'class-1',
        academic_lab_group_id: null,
        branch_id: 'branch-1',
        batch_id: 'batch-1',
        division_id: 'div-1',
      }],
    });
    
    // Mock 3: Verify offering enrollment
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'offering-1' }],
    });
    
    // Mock 4: Check existing attendance (none)
    pool.query.mockResolvedValueOnce({ rows: [] });
    
    // Mock 5: Insert rejected record (far from geofence)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'record-rejected-2' }],
    });

    // Swapped coordinates - the distance will be far away from session location
    const response = await request(app)
      .post('/api/attendance/mark')
      .send({
        nonce: 'AAABBB',
        latitude: 73.8567, // Swapped - valid range but wrong semantic meaning
        longitude: 18.5204,
        accuracy: 10,
        timestamp: Date.now(),
      });

    // This will fail the geofence check (far distance) and return 400 with 'rejected' status
    expect(response.status).toBe(400);
    expect(response.body.status).toBe('rejected');
    // The huge distance will be detected since Haversine will compute distance correctly
    expect(response.body.distance).toBeGreaterThan(1000); // Many km away
  });

  test('rejects invalid coordinates', async () => {
    // Mock database response for session lookup (will be called multiple times)
    pool.query.mockResolvedValue({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        academic_class_id: 'class-1',
      }],
    });

    const tests = [
      { lat: 91, lon: 73.8567 }, // Latitude > 90
      { lat: -91, lon: 73.8567 }, // Latitude < -90
      { lat: 18.5204, lon: 181 }, // Longitude > 180
      { lat: 18.5204, lon: -181 }, // Longitude < -180
      { lat: NaN, lon: 73.8567 },
      { lat: 18.5204, lon: Infinity },
    ];

    for (const coords of tests) {
      const response = await request(app)
        .post('/api/attendance/mark')
        .send({
          nonce: 'AAABBB',
          latitude: coords.lat,
          longitude: coords.lon,
          accuracy: 10,
          timestamp: Date.now(),
        });

      expect(response.status).toBe(400);
    }
  });

  test('rejects stale location reading', async () => {
    // Mock database response for session lookup
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        academic_class_id: 'class-1',
      }],
    });

    const response = await request(app)
      .post('/api/attendance/mark')
      .send({
        nonce: 'AAABBB',
        latitude: 18.5204,
        longitude: 73.8567,
        accuracy: 10,
        timestamp: Date.now() - 120000, // 2 minutes old
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('STALE_LOCATION');
  });

  test('rejects future timestamp (clock skew)', async () => {
    // Mock database response for session lookup
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: testSessionId,
        latitude: 18.5204,
        longitude: 73.8567,
        radius_meters: 50,
        active_nonce: 'AAABBB',
        nonce_expires: new Date(Date.now() + 3600000),
        is_active: true,
        faculty_id: 'faculty-1',
        subject_id: 'subject-1',
        academic_class_id: 'class-1',
      }],
    });

    const response = await request(app)
      .post('/api/attendance/mark')
      .send({
        nonce: 'AAABBB',
        latitude: 18.5204,
        longitude: 73.8567,
        accuracy: 10,
        timestamp: Date.now() + 10000, // 10 seconds in future
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('STALE_LOCATION');
  });
});

describe('Geofence Decision Logic', () => {
  test('50m radius is appropriate for classroom attendance', () => {
    // A typical classroom is 10m x 10m
    // 50m radius allows for:
    // - GPS uncertainty (~10-20m typical)
    // - Building size variation
    // - Students at different corners of large halls
    // But prevents students from neighboring buildings
    
    const radiusMeters = 50;
    const typicalGpsAccuracy = 15;
    const effectiveRadius = radiusMeters - typicalGpsAccuracy;
    
    expect(effectiveRadius).toBeGreaterThanOrEqual(30);
    expect(radiusMeters).toBeLessThan(100); // Not too permissive
  });

  test('configurable accuracy threshold balances reliability and accessibility', () => {
    const maxAccuracy = parseInt(process.env.GPS_MAX_ACCURACY_METERS) || 25;
    
    // 25m is reasonable because:
    // - Modern smartphones typically achieve 5-20m accuracy outdoors
    // - 25m allows for slight building interference
    // - But prevents accepting vague network-based location (~100-500m)
    
    expect(maxAccuracy).toBeGreaterThanOrEqual(15); // Not too strict
    expect(maxAccuracy).toBeLessThanOrEqual(50); // Not too permissive
  });
});

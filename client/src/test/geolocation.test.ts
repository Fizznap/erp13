/**
 * Geolocation Module Tests
 * 
 * Tests GPS location acquisition, accuracy validation, retry logic,
 * and error handling for attendance verification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { acquireAttendanceLocation, formatAccuracy, getAccuracyQuality } from '../lib/geolocation';

describe('Geolocation Acquisition', () => {
  let mockGeolocation: any;

  beforeEach(() => {
    // Mock navigator.geolocation
    mockGeolocation = {
      getCurrentPosition: vi.fn(),
    };
    Object.defineProperty(global.navigator, 'geolocation', {
      value: mockGeolocation,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acquires accurate location successfully', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success: any) => {
      success({
        coords: {
          latitude: 18.5204,
          longitude: 73.8567,
          accuracy: 15,
        },
        timestamp: Date.now(),
      });
    });

    const result = await acquireAttendanceLocation();
    
    expect(result.latitude).toBe(18.5204);
    expect(result.longitude).toBe(73.8567);
    expect(result.accuracy).toBe(15);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('rejects location with insufficient accuracy', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success: any) => {
      success({
        coords: {
          latitude: 18.5204,
          longitude: 73.8567,
          accuracy: 50, // Too low (default max is 25)
        },
        timestamp: Date.now(),
      });
    });

    await expect(acquireAttendanceLocation()).rejects.toMatchObject({
      code: 'ACCURACY_TOO_LOW',
      reportedAccuracy: 50,
    });
  });

  it('retries on poor accuracy up to max attempts', async () => {
    let callCount = 0;
    mockGeolocation.getCurrentPosition.mockImplementation((success: any) => {
      callCount++;
      if (callCount < 3) {
        // First two attempts: poor accuracy
        success({
          coords: { latitude: 18.5204, longitude: 73.8567, accuracy: 40 },
          timestamp: Date.now(),
        });
      } else {
        // Third attempt: good accuracy
        success({
          coords: { latitude: 18.5204, longitude: 73.8567, accuracy: 15 },
          timestamp: Date.now(),
        });
      }
    });

    const result = await acquireAttendanceLocation({ maxAttempts: 3 });
    
    expect(callCount).toBe(3);
    expect(result.accuracy).toBe(15);
  });

  it('fails after max attempts with poor accuracy', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success: any) => {
      success({
        coords: { latitude: 18.5204, longitude: 73.8567, accuracy: 50 },
        timestamp: Date.now(),
      });
    });

    await expect(
      acquireAttendanceLocation({ maxAttempts: 2 })
    ).rejects.toMatchObject({
      code: 'ACCURACY_TOO_LOW',
    });

    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('handles permission denied error', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((_: any, error: any) => {
      error({ code: 1, message: 'User denied Geolocation' }); // PERMISSION_DENIED
    });

    await expect(acquireAttendanceLocation()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: expect.stringContaining('permission denied'),
    });
  });

  it('handles position unavailable error', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((_: any, error: any) => {
      error({ code: 2, message: 'Position unavailable' }); // POSITION_UNAVAILABLE
    });

    await expect(acquireAttendanceLocation()).rejects.toMatchObject({
      code: 'POSITION_UNAVAILABLE',
    });
  });

  it('handles timeout error', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((_: any, error: any) => {
      error({ code: 3, message: 'Timeout' }); // TIMEOUT
    });

    await expect(acquireAttendanceLocation()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('rejects invalid coordinates', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success: any) => {
      success({
        coords: { latitude: 95, longitude: 73.8567, accuracy: 10 }, // Invalid lat
        timestamp: Date.now(),
      });
    });

    await expect(acquireAttendanceLocation()).rejects.toMatchObject({
      code: 'POSITION_UNAVAILABLE',
      message: expect.stringContaining('invalid coordinates'),
    });
  });

  it('uses high accuracy and fresh reading options', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success: any, _error: any, options: any) => {
      expect(options.enableHighAccuracy).toBe(true);
      expect(options.maximumAge).toBe(0);
      expect(options.timeout).toBeGreaterThan(0);
      
      success({
        coords: { latitude: 18.5204, longitude: 73.8567, accuracy: 15 },
        timestamp: Date.now(),
      });
    });

    await acquireAttendanceLocation();
    
    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        enableHighAccuracy: true,
        maximumAge: 0,
      })
    );
  });

  it('throws NOT_SUPPORTED when geolocation is unavailable', async () => {
    delete (global.navigator as any).geolocation;

    await expect(acquireAttendanceLocation()).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
  });
});

describe('Accuracy Formatting', () => {
  it('formats meters correctly', () => {
    expect(formatAccuracy(0.5)).toBe('50cm');
    expect(formatAccuracy(5)).toBe('5m');
    expect(formatAccuracy(25)).toBe('25m');
    expect(formatAccuracy(150)).toBe('150m');
    expect(formatAccuracy(1500)).toBe('1.5km');
  });

  it('classifies accuracy quality correctly', () => {
    expect(getAccuracyQuality(5)).toBe('excellent');
    expect(getAccuracyQuality(15)).toBe('good');
    expect(getAccuracyQuality(35)).toBe('fair');
    expect(getAccuracyQuality(100)).toBe('poor');
  });
});

/**
 * GPS Attendance Location Acquisition
 * 
 * Provides reliable, accurate location readings for attendance verification.
 * Implements configurable accuracy thresholds, retry logic, and clear error messages.
 */

export type LocationResult = {
  latitude: number;
  longitude: number;
  accuracy: number; // horizontal accuracy in meters
  timestamp: number; // milliseconds since epoch
};

export type LocationError = {
  code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'ACCURACY_TOO_LOW' | 'NOT_SUPPORTED';
  message: string;
  reportedAccuracy?: number;
};

export type LocationOptions = {
  maxAccuracyMeters?: number; // Maximum acceptable accuracy (default: 25)
  timeoutMs?: number; // Timeout for acquisition (default: 15000)
  maxAttempts?: number; // Maximum retry attempts (default: 3)
  enableHighAccuracy?: boolean; // Request high accuracy (default: true)
};

const DEFAULT_OPTIONS: Required<LocationOptions> = {
  maxAccuracyMeters: 25,
  timeoutMs: 15000,
  maxAttempts: 3,
  enableHighAccuracy: true,
};

/**
 * Acquire a fresh, accurate GPS location for attendance verification.
 * 
 * Uses browser Geolocation API with high accuracy enabled and fresh reading required.
 * Validates accuracy against configurable threshold.
 * 
 * @param options - Configuration options
 * @returns Promise resolving to location result or rejecting with location error
 */
export async function acquireAttendanceLocation(
  options: LocationOptions = {}
): Promise<LocationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check if geolocation is supported
  if (!('geolocation' in navigator)) {
    throw {
      code: 'NOT_SUPPORTED',
      message: 'Geolocation is not supported by this device or browser.',
    } as LocationError;
  }

  let attempts = 0;
  let lastError: LocationError | null = null;

  while (attempts < opts.maxAttempts) {
    attempts++;
    
    try {
      const result = await acquireSingleReading(opts.timeoutMs, opts.enableHighAccuracy);
      
      // Validate accuracy
      if (result.accuracy > opts.maxAccuracyMeters) {
        lastError = {
          code: 'ACCURACY_TOO_LOW',
          message: `GPS accuracy is ${Math.round(result.accuracy)}m. Need ${opts.maxAccuracyMeters}m or better. Try moving to an open area.`,
          reportedAccuracy: result.accuracy,
        };
        
        // If this is not the last attempt, wait briefly before retrying
        if (attempts < opts.maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      } else {
        // Success - good enough accuracy
        return result;
      }
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on permission denied or not supported
      if (error.code === 'PERMISSION_DENIED' || error.code === 'NOT_SUPPORTED') {
        break;
      }
      
      // Wait briefly before retry
      if (attempts < opts.maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  // All attempts failed
  throw lastError || {
    code: 'POSITION_UNAVAILABLE',
    message: 'Unable to determine your location after multiple attempts.',
  };
}

/**
 * Acquire a single GPS reading with specified options.
 */
function acquireSingleReading(
  timeoutMs: number,
  enableHighAccuracy: boolean
): Promise<LocationResult> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Validate coordinate ranges
        const { latitude, longitude, accuracy } = position.coords;
        
        if (!isValidCoordinate(latitude, longitude)) {
          reject({
            code: 'POSITION_UNAVAILABLE',
            message: 'Received invalid coordinates from device.',
          } as LocationError);
          return;
        }

        resolve({
          latitude,
          longitude,
          accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => {
        reject(mapGeolocationError(error));
      },
      {
        enableHighAccuracy, // Request GPS, not network/WiFi approximation
        maximumAge: 0, // Must be a fresh reading, not cached
        timeout: timeoutMs,
      }
    );
  });
}

/**
 * Map browser GeolocationPositionError to our LocationError type.
 */
function mapGeolocationError(error: GeolocationPositionError): LocationError {
  // GeolocationPositionError codes: PERMISSION_DENIED=1, POSITION_UNAVAILABLE=2, TIMEOUT=3
  switch (error.code) {
    case 1: // PERMISSION_DENIED
      return {
        code: 'PERMISSION_DENIED',
        message: 'Location permission denied. Enable location services in your browser settings.',
      };
    
    case 2: // POSITION_UNAVAILABLE
      return {
        code: 'POSITION_UNAVAILABLE',
        message: 'Location unavailable. Ensure GPS is enabled and you are not indoors.',
      };
    
    case 3: // TIMEOUT
      return {
        code: 'TIMEOUT',
        message: 'Location request timed out. Try again in an area with clear sky visibility.',
      };
    
    default:
      return {
        code: 'POSITION_UNAVAILABLE',
        message: error.message || 'Failed to get your location.',
      };
  }
}

/**
 * Validate that coordinates are within valid ranges.
 */
function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Format accuracy for display.
 */
export function formatAccuracy(meters: number): string {
  if (meters < 1) return `${Math.round(meters * 100)}cm`;
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Get accuracy quality description.
 */
export function getAccuracyQuality(meters: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (meters <= 10) return 'excellent';
  if (meters <= 25) return 'good';
  if (meters <= 50) return 'fair';
  return 'poor';
}

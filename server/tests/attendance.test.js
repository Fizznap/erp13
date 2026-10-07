const { haversineDistance } = require('../src/utils/geo');

describe('Attendance Logic', () => {
  test('Haversine distance calculation is accurate', () => {
    // Distance between NY and London
    const lat1 = 40.7128;
    const lon1 = -74.0060;
    const lat2 = 51.5074;
    const lon2 = -0.1278;
    
    const distance = haversineDistance(lat1, lon1, lat2, lon2);
    // Should be around 5570 km = 5,570,000 meters
    expect(distance).toBeGreaterThan(5500000);
    expect(distance).toBeLessThan(5600000);
  });

  test('Distance within 50m radius', () => {
    const lat1 = 40.7128;
    const lon1 = -74.0060;
    // Tiny offset
    const lat2 = 40.712801;
    const lon2 = -74.006001;

    const distance = haversineDistance(lat1, lon1, lat2, lon2);
    expect(distance).toBeLessThan(50);
  });
});

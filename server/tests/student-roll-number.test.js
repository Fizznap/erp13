const { parseStudentRollNumber, canonicalBranchCode } = require('../src/utils/studentRollNumber');

describe('UST student roll numbers', () => {
  test.each([
    ['UST24R0102085', 'BTECH-CSE'],
    [' ust24r0101003 ', 'BTECH-AIML'],
    ['UST24R0104060', 'BTECH-CYS'],
  ])('maps %s to branch %s and derives the admission batch', (rollNumber, branchCode) => {
    const result = parseStudentRollNumber(rollNumber);
    expect(result.branch.code).toBe(branchCode);
    expect(result.admissionYear).toBe(2024);
    expect(result.normalized).toMatch(/^UST24R/);
  });

  test.each(['UST24L0102085', 'UST24R0102', 'UST24R01020850', 'xUST24R0102085'])
    ('rejects malformed or non-R roll number %s', (rollNumber) => {
      expect(parseStudentRollNumber(rollNumber)).toBeNull();
    });

  test('recognizes configured academic branch aliases', () => {
    expect(canonicalBranchCode('CSE')).toBe('BTECH-CSE');
    expect(canonicalBranchCode('Cyber-Security')).toBe('BTECH-CYS');
    expect(canonicalBranchCode('UNRELATED')).toBeNull();
  });
});

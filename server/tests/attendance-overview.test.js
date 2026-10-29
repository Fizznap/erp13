const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../src/middleware/auth', () => {
  const jwtModule = require('jsonwebtoken');
  return {
    authenticate: (req, res, next) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      try {
        req.user = jwtModule.verify(token, process.env.JWT_SECRET || 'test-secret');
        next();
      } catch {
        res.status(401).json({ error: 'Invalid token' });
      }
    },
    authorize: (...roles) => (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    },
  };
});

const attendanceRouter = require('../src/routes/attendance');
const { pool: mockPool } = require('../src/db/pool');

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRouter);

describe('Student Attendance Overview API', () => {
  let studentToken, adminToken;
  const secret = process.env.JWT_SECRET || 'test-secret';

  beforeAll(() => {
    studentToken = jwt.sign({ id: 'student-1', role: 'student' }, secret);
    adminToken = jwt.sign({ id: 'admin-1', role: 'admin' }, secret);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-student users with 403', async () => {
    const res = await request(app)
      .get('/api/attendance/my/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
  });

  it('calculates semester-wise and subject-wise attendance breakdown correctly', async () => {
    // 1. studentUser query
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'student-1',
            academic_class_id: 'class-sem5',
            academic_lab_group_id: null,
            branch_id: 'b-cse',
            batch_id: 'batch-2024',
            division_id: 'div-b',
            semester_id: 'sem-5',
            branch_code: 'BTECH-CSE',
            branch_name: 'Computer Science',
            batch_start_year: 2024,
            batch_end_year: 2028,
            division_name: 'B',
            current_semester_number: 5,
          },
        ],
      })
      // 2. semQuery (available semesters)
      .mockResolvedValueOnce({
        rows: [
          { semester_number: 4, academic_class_id: 'class-sem4' },
          { semester_number: 5, academic_class_id: 'class-sem5' },
        ],
      })
      // 3. offeringsQuery
      .mockResolvedValueOnce({
        rows: [
          {
            offering_id: 'off-cn',
            subject_id: 'sub-cn',
            subject_name: 'Computer Networks',
            subject_code: 'CS501',
            faculty_name: 'Dr. Smith',
          },
          {
            offering_id: 'off-cn-lab',
            subject_id: 'sub-cn-lab',
            subject_name: 'Computer Networks Lab',
            subject_code: 'CS501L',
            faculty_name: 'Dr. Smith',
          },
        ],
      })
      // 4. sessionsQuery for offering 1 (CS501: 32 total, 25 present)
      .mockResolvedValueOnce({
        rows: [
          ...Array(25).fill({ id: 's-p', is_present: true }),
          ...Array(7).fill({ id: 's-a', is_present: false }),
        ],
      })
      // 5. sessionsQuery for offering 2 (CS501L: 12 total, 9 present)
      .mockResolvedValueOnce({
        rows: [
          ...Array(9).fill({ id: 's-p', is_present: true }),
          ...Array(3).fill({ id: 's-a', is_present: false }),
        ],
      });

    const res = await request(app)
      .get('/api/attendance/my/overview?semester=5')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.semesters).toHaveLength(2);
    expect(res.body.selectedSemester).toBe(5);

    // Total: 32 + 12 = 44 sessions, Attended: 25 + 9 = 34 -> (34/44)*100 = 77.27%
    expect(res.body.overall.total).toBe(44);
    expect(res.body.overall.attended).toBe(34);
    expect(res.body.overall.percentage).toBe(77.27);

    // Subject breakdown
    expect(res.body.subjects).toHaveLength(2);
    expect(res.body.subjects[0].name).toBe('Computer Networks');
    expect(res.body.subjects[0].total).toBe(32);
    expect(res.body.subjects[0].attended).toBe(25);
    expect(res.body.subjects[0].percentage).toBe(78.13);
    expect(res.body.subjects[0].isLab).toBe(false);

    expect(res.body.subjects[1].name).toBe('Computer Networks Lab');
    expect(res.body.subjects[1].isLab).toBe(true);
    expect(res.body.subjects[1].percentage).toBe(75.0);
  });
});

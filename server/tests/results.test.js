const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock database pool BEFORE requiring routes
jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
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
    requireRole: (roles) => (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    },
  };
});

const resultsRouter = require('../src/routes/results');
const { pool: mockPool } = require('../src/db/pool');

const app = express();
app.use(express.json());
app.use('/api/results', resultsRouter);

describe('Results API', () => {
  let adminToken, facultyToken, studentToken, student2Token;
  const adminUser = { id: 'admin-id', role: 'admin', email: 'admin@test.com' };
  const facultyUser = { id: 'faculty-id', role: 'faculty', email: 'faculty@test.com' };
  const studentUser = { id: 'student-id', role: 'student', email: 'student@test.com' };
  const student2User = { id: 'student2-id', role: 'student', email: 'student2@test.com' };

  beforeAll(() => {
    const secret = process.env.JWT_SECRET || 'test-secret';
    adminToken = jwt.sign(adminUser, secret);
    facultyToken = jwt.sign(facultyUser, secret);
    studentToken = jwt.sign(studentUser, secret);
    student2Token = jwt.sign(student2User, secret);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/results/student/:studentId', () => {
    it('should allow student to view their own results', async () => {
      const mockResults = [
        {
          id: 'result-1',
          student_id: 'student-id',
          subject_id: 'subject-1',
          academic_class_id: 'class-1',
          subject_name: 'Mathematics',
          subject_code: 'MATH101',
          internal_marks: 30,
          external_marks: 65,
          total_marks: 95,
          grade: 'O',
          grade_points: 10.0,
          credits: 4.0,
          status: 'published',
          exam_type: 'regular',
          academic_year: 2024,
          is_synthetic: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockResults });

      const response = await request(app)
        .get('/api/results/student/student-id')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].grade).toBe('O');
      expect(response.body.summary.cgpa).toBe('10.00');
    });

    it('should prevent student from viewing other students results', async () => {
      const response = await request(app)
        .get('/api/results/student/student2-id')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('your own');
    });

    it('should allow admin to view any students results', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/results/student/student2-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
    });

    it('should filter out draft results for students', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/results/student/student-id')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'published'"),
        expect.any(Array)
      );
    });

    it('should calculate SGPA correctly', async () => {
      const mockResults = [
        {
          id: '1',
          student_id: 'student-id',
          subject_id: 'sub-1',
          academic_class_id: 'class-1',
          subject_name: 'Math',
          subject_code: 'M101',
          grade: 'O',
          grade_points: 10.0,
          credits: 4.0,
          status: 'published',
          exam_type: 'regular',
          academic_year: 2024,
          is_synthetic: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: '2',
          student_id: 'student-id',
          subject_id: 'sub-2',
          academic_class_id: 'class-1',
          subject_name: 'Physics',
          subject_code: 'P101',
          grade: 'A+',
          grade_points: 9.0,
          credits: 4.0,
          status: 'published',
          exam_type: 'regular',
          academic_year: 2024,
          is_synthetic: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockResults });

      const response = await request(app)
        .get('/api/results/student/student-id')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(response.status).toBe(200);
      // SGPA = (10*4 + 9*4) / (4+4) = 76/8 = 9.50
      expect(response.body.summary.cgpa).toBe('9.50');
    });
  });

  describe('GET /api/results/class/:classId', () => {
    it('should allow faculty to view class results', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'result-1',
            student_id: 'student-id',
            subject_id: 'subject-1',
            academic_class_id: 'class-1',
            subject_name: 'Math',
            subject_code: 'M101',
            student_name: 'John Doe',
            roll_number: 'UST24R0102085',
            grade: 'O',
            grade_points: 10.0,
            credits: 4.0,
            status: 'published',
            exam_type: 'regular',
            academic_year: 2024,
            is_synthetic: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const response = await request(app)
        .get('/api/results/class/class-1')
        .set('Authorization', `Bearer ${facultyToken}`);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].rollNumber).toBe('UST24R0102085');
    });

    it('should prevent students from viewing class results', async () => {
      const response = await request(app)
        .get('/api/results/class/class-1')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/results', () => {
    it('should allow faculty to create a result', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // Check existing
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'new-result-id',
              student_id: 'student-id',
              subject_id: 'subject-1',
              academic_class_id: 'class-1',
              total_marks: 85,
              grade: 'A+',
              grade_points: 9.0,
              credits: 4.0,
              status: 'draft',
              exam_type: 'regular',
              academic_year: 2024,
              is_synthetic: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        });

      const response = await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({
          studentId: 'student-id',
          subjectId: 'subject-1',
          academicClassId: 'class-1',
          totalMarks: 85,
          credits: 4.0,
          academicYear: 2024,
        });

      expect(response.status).toBe(201);
      expect(response.body.result.grade).toBe('A+');
    });

    it('should prevent duplicate results', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

      const response = await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({
          studentId: 'student-id',
          subjectId: 'subject-1',
          academicClassId: 'class-1',
          academicYear: 2024,
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already exists');
    });

    it('should prevent students from creating results', async () => {
      const response = await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          studentId: 'student-id',
          subjectId: 'subject-1',
          academicClassId: 'class-1',
          academicYear: 2024,
        });

      expect(response.status).toBe(403);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({
          studentId: 'student-id',
          // Missing subjectId, academicClassId, academicYear
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });
  });

  describe('PATCH /api/results/:id', () => {
    it('should allow faculty to update a result', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'result-1',
            student_id: 'student-id',
            subject_id: 'subject-1',
            academic_class_id: 'class-1',
            total_marks: 90,
            grade: 'O',
            grade_points: 10.0,
            credits: 4.0,
            status: 'draft',
            exam_type: 'regular',
            academic_year: 2024,
            is_synthetic: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const response = await request(app)
        .patch('/api/results/result-1')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ totalMarks: 90, status: 'published' });

      expect(response.status).toBe(200);
      expect(response.body.result.totalMarks).toBe(90);
    });

    it('should return 404 for non-existent result', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch('/api/results/non-existent')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ totalMarks: 90 });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/results/:id', () => {
    it('should allow admin to delete a result', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'result-1' }] });

      const response = await request(app)
        .delete('/api/results/result-1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted successfully');
    });

    it('should prevent faculty from deleting results', async () => {
      const response = await request(app)
        .delete('/api/results/result-1')
        .set('Authorization', `Bearer ${facultyToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/results/bulk', () => {
    it('should allow bulk creation of results', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };

      mockPool.connect.mockResolvedValueOnce(mockClient);
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          // First insert
          rows: [
            {
              id: 'result-1',
              student_id: 'student-1',
              subject_id: 'subject-1',
              academic_class_id: 'class-1',
              grade: 'O',
              grade_points: 10.0,
              credits: 4.0,
              status: 'draft',
              exam_type: 'regular',
              academic_year: 2024,
              is_synthetic: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          // Second insert
          rows: [
            {
              id: 'result-2',
              student_id: 'student-2',
              subject_id: 'subject-1',
              academic_class_id: 'class-1',
              grade: 'A+',
              grade_points: 9.0,
              credits: 4.0,
              status: 'draft',
              exam_type: 'regular',
              academic_year: 2024,
              is_synthetic: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/api/results/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          results: [
            {
              studentId: 'student-1',
              subjectId: 'subject-1',
              academicClassId: 'class-1',
              totalMarks: 95,
              academicYear: 2024,
              isSynthetic: true,
            },
            {
              studentId: 'student-2',
              subjectId: 'subject-1',
              academicClassId: 'class-1',
              totalMarks: 85,
              academicYear: 2024,
              isSynthetic: true,
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.created).toBe(2);
      expect(response.body.errors).toBe(0);
    });

    it('should reject bulk operation with more than 500 results', async () => {
      const results = Array(501).fill({
        studentId: 'student-id',
        subjectId: 'subject-1',
        academicClassId: 'class-1',
        academicYear: 2024,
      });

      const response = await request(app)
        .post('/api/results/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ results });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('500');
    });
  });

  describe('POST /api/results/publish', () => {
    it('should allow faculty to publish results', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'result-1' }, { id: 'result-2' }],
      });

      const response = await request(app)
        .post('/api/results/publish')
        .set('Authorization', `Bearer ${facultyToken}`)
        .send({ resultIds: ['result-1', 'result-2'] });

      expect(response.status).toBe(200);
      expect(response.body.publishedCount).toBe(2);
    });

    it('should prevent students from publishing results', async () => {
      const response = await request(app)
        .post('/api/results/publish')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ resultIds: ['result-1'] });

      expect(response.status).toBe(403);
    });
  });
});

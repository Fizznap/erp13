const fs = require('fs');
const { pool } = require('../src/db/pool');
const { embedBatch, generateMetadata } = require('../src/services/rag');
const { processResource } = require('../src/services/processor');

jest.mock('pdf-parse', () => jest.fn());
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/rag', () => ({
  embedBatch: jest.fn(),
  generateMetadata: jest.fn(),
}));

const parsePdf = require('pdf-parse');

describe('resource processing', () => {
  const resourceId = 'resource-id';
  const resource = { id: resourceId, file_path: 'test.pdf', original_name: 'test.pdf' };
  const extractedText = Array(100).fill('material').join(' ');
  let readFileSync;

  beforeEach(() => {
    jest.clearAllMocks();
    readFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('pdf fixture'));
    parsePdf.mockResolvedValue({ text: extractedText, numpages: 1 });
    generateMetadata.mockResolvedValue({ summary: 'Summary', keyTopics: [], bulletPoints: [] });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM resources')) return Promise.resolve({ rows: [resource] });
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => readFileSync.mockRestore());

  test('marks resource failed and propagates an embedding error for queue retries', async () => {
    embedBatch.mockRejectedValue(new Error('provider unavailable'));

    await expect(processResource(resourceId)).rejects.toThrow('provider unavailable');

    expect(pool.query).toHaveBeenCalledWith(
      "UPDATE resources SET status = 'failed', stage = 'FAILED', error_message = $1 WHERE id = $2",
      ['provider unavailable', resourceId],
    );
    expect(pool.query.mock.calls.some(([sql]) => sql.includes("status = 'ready'"))).toBe(false);
    expect(generateMetadata).not.toHaveBeenCalled();
  });

  test('rejects vectors whose dimensions do not match the database column', async () => {
    embedBatch.mockResolvedValue([Array(767).fill(0)]);

    await expect(processResource(resourceId)).rejects.toThrow('invalid vectors');

    expect(pool.query.mock.calls.some(([sql]) => sql.includes("status = 'ready'"))).toBe(false);
  });
});

let Queue;
try {
  Queue = require('bull');
} catch {
  console.warn('Bull not available — queue features disabled. Processing will run inline.');
}

let processingQueue = null;

function initQueue() {
  if (!Queue) return null;

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    processingQueue = new Queue('resource-processing', redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    // Process jobs
    processingQueue.process('process-resource', async (job) => {
      const { processResource } = require('../services/processor');
      const { resourceId } = job.data;
      console.log(`[Queue] Processing resource ${resourceId}...`);
      return processResource(resourceId);
    });

    processingQueue.on('completed', (job, result) => {
      console.log(`[Queue] Job ${job.id} completed:`, result);
    });

    processingQueue.on('failed', (job, err) => {
      console.error(`[Queue] Job ${job.id} failed:`, err.message);
    });

    console.log('Bull queue initialized (Redis connected)');
    return processingQueue;
  } catch (err) {
    console.warn('Failed to initialize Bull queue:', err.message);
    return null;
  }
}

function getProcessingQueue() {
  return processingQueue;
}

module.exports = { initQueue, getProcessingQueue };

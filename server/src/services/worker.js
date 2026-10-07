require('dotenv').config();
const { initQueue } = require('../jobs/queue');

console.log('Starting worker process...');
const queue = initQueue();

if (!queue) {
  console.error('Failed to initialize queue. Worker exiting.');
  process.exit(1);
}

console.log('Worker is up and listening for jobs...');

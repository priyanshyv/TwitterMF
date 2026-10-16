// The worker process: runs background jobs, serves no HTTP.
//   dev:  npm run dev (starts it alongside the API and web app)
//   prod: node dist/worker
// Run as many as you like; BullMQ hands each job to exactly one of them.
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker/worker.module.js';

const app = await NestFactory.createApplicationContext(WorkerModule, {
  bufferLogs: true,
});
const logger = app.get(Logger);
app.useLogger(logger);
app.enableShutdownHooks(); // Ctrl+C / SIGTERM: finish current jobs, then exit
logger.log('ready: processing fanout and notifications', 'Worker');

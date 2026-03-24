/**
 * server/index.ts
 *
 * Entry point — loads .env, builds the Express app, and starts listening.
 * The application logic lives in server/app.ts so it can be imported by
 * integration tests without binding to a port.
 */

import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { buildApp } from './app';

const PORT = process.env.API_PORT || 3001;
const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_FILE = path.join(LOG_DIR, 'downloads.log');

const app = buildApp();

const server = app.listen(PORT, () => {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[${timestamp}] [INFO] Local Link Downloader API server running on port ${PORT}\n`);
  process.stdout.write(`[${timestamp}] [INFO] Log file: ${path.resolve(LOG_FILE)}\n`);
});

// Node 18+ defaults requestTimeout to 5 minutes, which causes 408s on large
// uploads.  Raise it to 30 minutes so big files have time to transfer.
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000; // keep headers timeout tight
server.timeout = 0; // no idle timeout — long transfers are expected

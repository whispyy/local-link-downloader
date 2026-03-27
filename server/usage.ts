/**
 * server/usage.ts
 *
 * Usage tracking: logs every API request to a JSONL file and provides
 * a reader with pagination + filtering for the usage page.
 */

import express from 'express';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { appendFile, readFile } from 'fs/promises';

export interface UsageEntry {
  timestamp: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  statusCode: number;
  responseTimeMs: number;
}

export interface UsageReadOpts {
  from?: string;
  to?: string;
  path?: string;
  page: number;
  limit: number;
}

export function buildUsageTracker() {
  const LOG_DIR = process.env.LOG_DIR || './logs';
  const USAGE_FILE = path.join(LOG_DIR, 'usage.jsonl');
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  function logUsage(entry: UsageEntry) {
    appendFile(USAGE_FILE, JSON.stringify(entry) + '\n').catch(() => {});
  }

  function middleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    // Don't log the usage endpoint itself to avoid noise
    if (req.path === '/usage') { next(); return; }
    const start = Date.now();
    res.on('finish', () => {
      logUsage({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || '',
        statusCode: res.statusCode,
        responseTimeMs: Date.now() - start,
      });
    });
    next();
  }

  async function read(opts: UsageReadOpts): Promise<{ entries: UsageEntry[]; total: number }> {
    if (!existsSync(USAGE_FILE)) return { entries: [], total: 0 };
    const raw = await readFile(USAGE_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    let entries: UsageEntry[] = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    // Reverse so newest first
    entries.reverse();

    // Date filters
    if (opts.from) {
      const fromTs = new Date(opts.from).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() >= fromTs);
    }
    if (opts.to) {
      const toTs = new Date(opts.to).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() <= toTs);
    }
    if (opts.path) {
      const needle = opts.path.toLowerCase();
      entries = entries.filter((e) => e.path.toLowerCase().includes(needle));
    }

    const total = entries.length;
    const offset = (opts.page - 1) * opts.limit;
    return { entries: entries.slice(offset, offset + opts.limit), total };
  }

  return { middleware, read };
}

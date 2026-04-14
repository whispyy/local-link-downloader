/**
 * server/autoclean.ts
 *
 * Auto-clean feature: per-folder retention policies that delete files
 * older than N days based on file mtime. Runs on server start, then
 * every 24 hours via setInterval.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { readFile, writeFile, readdir, stat, unlink, rmdir } from 'fs/promises';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const CONFIG_FILE = path.join(DATA_DIR, 'auto-clean.json');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_CLEAN_DEPTH = 2; // only recurse 2 levels into each configured folder

export type Rules = Record<string, number>;

interface AutoCleanConfig {
  rules: Rules;
}

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadRulesSync(): Rules {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const config: AutoCleanConfig = JSON.parse(raw);
    return config.rules || {};
  } catch {
    return {};
  }
}

export async function loadRules(): Promise<Rules> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    const config: AutoCleanConfig = JSON.parse(raw);
    return config.rules || {};
  } catch {
    return {};
  }
}

export async function saveRules(rules: Rules): Promise<void> {
  ensureDataDir();
  const config: AutoCleanConfig = { rules };
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

type LogFn = (level: 'INFO' | 'ERROR' | 'WARN', message: string, meta?: Record<string, unknown>) => void;

async function walkAndClean(
  dirPath: string,
  maxAgeMs: number,
  now: number,
  log: LogFn,
  depth: number,
): Promise<number> {
  let deleted = 0;
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    log('WARN', 'Auto-clean: cannot read directory', { dir: dirPath, error: String(err) });
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        if (depth < MAX_CLEAN_DEPTH) {
          deleted += await walkAndClean(fullPath, maxAgeMs, now, log, depth + 1);
          // Try to remove directory if empty after cleanup
          try {
            await rmdir(fullPath);
            log('INFO', 'Auto-clean: removed empty directory', { dir: fullPath });
          } catch {
            // Not empty or other error — ignore
          }
        }
      } else if (entry.isFile()) {
        const fileStat = await stat(fullPath);
        if (now - fileStat.mtimeMs > maxAgeMs) {
          await unlink(fullPath);
          deleted++;
          log('INFO', 'Auto-clean: deleted old file', { file: fullPath, ageDays: Math.round((now - fileStat.mtimeMs) / MS_PER_DAY) });
        }
      }
    } catch (err) {
      log('ERROR', 'Auto-clean: error processing entry', { path: fullPath, error: String(err) });
    }
  }

  return deleted;
}

export async function runCleanup(
  folderMapping: Map<string, string>,
  rules: Rules,
  log: LogFn,
): Promise<void> {
  const now = Date.now();
  for (const [folderKey, maxDays] of Object.entries(rules)) {
    if (!maxDays || maxDays <= 0) continue;
    const folderPath = folderMapping.get(folderKey);
    if (!folderPath) {
      log('WARN', 'Auto-clean: unknown folder key, skipping', { folderKey });
      continue;
    }
    if (!existsSync(folderPath)) {
      log('WARN', 'Auto-clean: folder does not exist, skipping', { folderKey, folderPath });
      continue;
    }

    const maxAgeMs = maxDays * MS_PER_DAY;
    log('INFO', 'Auto-clean: scanning folder', { folderKey, maxDays });
    const deleted = await walkAndClean(folderPath, maxAgeMs, now, log, 0);
    if (deleted > 0) {
      log('INFO', 'Auto-clean: cleanup complete', { folderKey, deletedFiles: deleted });
    }
  }
}

export interface AutoCleanHandle {
  getRules(): Rules;
  updateRules(newRules: Rules): void;
}

export function startAutoClean(
  folderMapping: Map<string, string>,
  log: LogFn,
  initialRules: Rules,
): AutoCleanHandle {
  let currentRules: Rules = initialRules;

  // Run initial cleanup with pre-loaded rules
  runCleanup(folderMapping, currentRules, log).catch((err) => {
    log('ERROR', 'Auto-clean: initial run failed', { error: String(err) });
  });

  // Schedule cleanup every 24 hours
  const interval = setInterval(() => {
    runCleanup(folderMapping, currentRules, log).catch((err) => {
      log('ERROR', 'Auto-clean: scheduled run failed', { error: String(err) });
    });
  }, MS_PER_DAY);
  interval.unref();

  return {
    getRules() {
      return currentRules;
    },
    updateRules(newRules: Rules) {
      currentRules = newRules;
    },
  };
}

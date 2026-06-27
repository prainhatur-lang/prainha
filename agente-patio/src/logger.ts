// Logger simples: console + arquivo logs/patio.log (JSON-lines).
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const LOG_DIR = resolve(process.cwd(), 'logs');
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // ignora
}
const LOG_FILE = resolve(LOG_DIR, 'patio.log');

type Level = 'info' | 'warn' | 'error';

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  const linha = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(extra ?? {}),
  };
  const txt = JSON.stringify(linha);
  // console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(txt);
  // arquivo (best-effort)
  try {
    appendFileSync(LOG_FILE, txt + '\n');
  } catch {
    // ignora
  }
}

export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};

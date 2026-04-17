// Logger simples: stdout + arquivo rotativo no dia
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const LOG_DIR = resolve(process.cwd(), 'logs');

function ensureDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ja existe
  }
}

function logFile(): string {
  const d = new Date();
  const dia = d.toISOString().slice(0, 10);
  return resolve(LOG_DIR, `agente-${dia}.log`);
}

function write(level: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${
    extra !== undefined ? ' ' + JSON.stringify(extra) : ''
  }`;
  console.log(line);
  ensureDir();
  try {
    appendFileSync(logFile(), line + '\n', 'utf8');
  } catch {
    // ignora erro de I/O para nao matar o agente
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => write('INFO', msg, extra),
  warn: (msg: string, extra?: unknown) => write('WARN', msg, extra),
  error: (msg: string, extra?: unknown) => write('ERROR', msg, extra),
};

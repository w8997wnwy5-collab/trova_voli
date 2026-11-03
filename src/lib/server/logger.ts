import { createHash } from 'node:crypto';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Keys whose values must never reach logs (credentials, personal or payment data).
const REDACT = /(authorization|token|secret|password|passwd|cookie|email|phone|name|passport|document|card|iban|cvv|address|birth)/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT.test(k) && !/^(provider|seller|airline)Name$/i.test(k) ? '[redacted]' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

/** One-way, salted hash so IPs can be correlated in logs without being stored. */
export function anonymizeIp(ip: string): string {
  return createHash('sha256').update(`fh:${ip}`).digest('hex').slice(0, 12);
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}, level: Level | 'silent' = (process.env.LOG_LEVEL as Level) || 'info'): Logger {
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const line = JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...(sanitize({ ...base, ...fields }) as object) });
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger({ ...base, ...fields }, level),
  };
}

export const logger = createLogger({ app: 'flight-hacker' });

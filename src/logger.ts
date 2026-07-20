type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minPriority = (): number => {
  const requested = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return PRIORITY[requested as LogLevel] ?? PRIORITY.info;
};

function serialize(extra: unknown): string {
  if (extra === undefined) return '';
  if (extra instanceof Error) return extra.stack ?? extra.message;
  if (typeof extra === 'string') return extra;
  try {
    return JSON.stringify(extra);
  } catch {
    return '[unserializable]';
  }
}

function formatLine(level: LogLevel, component: string, message: string, extra?: unknown): string {
  const suffix = serialize(extra);
  switch (level) {
    case 'warn':
      return suffix ? `[${component}] WARN: ${message} — ${suffix.slice(0, 120)}` : `[${component}] WARN: ${message}`;
    case 'error':
      return suffix ? `[${component}] ERROR: ${message} — ${suffix.slice(0, 120)}` : `[${component}] ERROR: ${message}`;
    default:
      return suffix ? `[${component}] ${message} ${suffix}` : `[${component}] ${message}`;
  }
}

function write(level: LogLevel, component: string, message: string, extra?: unknown): void {
  if (PRIORITY[level] < minPriority()) return;
  process.stderr.write(formatLine(level, component, message, extra) + '\n');
}

export function createLogger(component: string) {
  return {
    debug: (message: string, extra?: unknown) => write('debug', component, message, extra),
    info: (message: string, extra?: unknown) => write('info', component, message, extra),
    warn: (message: string, extra?: unknown) => write('warn', component, message, extra),
    error: (message: string, extra?: unknown) => write('error', component, message, extra),
    failure: (message: string, extra?: unknown) => {
      if (PRIORITY['warn'] < minPriority()) return;
      process.stderr.write(`[${component}] FAILED: ${message}\n`);
      if (extra !== undefined) {
        const detail = extra instanceof Error ? extra.message : String(extra);
        process.stderr.write(`  — ${detail.slice(0, 200)}\n`);
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;

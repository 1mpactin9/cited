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

function write(level: LogLevel, component: string, message: string, extra?: unknown): void {
  if (PRIORITY[level] < minPriority()) return;
  const suffix = serialize(extra);
  const line = suffix ? `[${component}] ${message} ${suffix}` : `[${component}] ${message}`;
  process.stderr.write(line + '\n');
}

export function createLogger(component: string) {
  return {
    debug: (message: string, extra?: unknown) => write('debug', component, message, extra),
    info: (message: string, extra?: unknown) => write('info', component, message, extra),
    warn: (message: string, extra?: unknown) => write('warn', component, message, extra),
    error: (message: string, extra?: unknown) => write('error', component, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;

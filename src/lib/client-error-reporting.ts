"use client";

type ClientErrorExtra = Record<string, unknown>;

export interface ClientErrorReportContext {
  source?: string;
  componentStack?: string;
  extra?: ClientErrorExtra;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

const REPORT_ENDPOINT = '/api/client-errors';
const MAX_STRING_LENGTH = 6000;
const MAX_EXTRA_DEPTH = 2;
const MAX_REPORTS_PER_MINUTE = 20;
const DEDUPE_WINDOW_MS = 10_000;

let reportWindowStartedAt = 0;
let reportCount = 0;
const recentReports = new Map<string, number>();

function safeString(value: unknown, fallback = '', maxLength = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function serializeUnknown(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;

  if (depth >= MAX_EXTRA_DEPTH) return '[object]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => serializeUnknown(item, depth + 1));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record)
        .slice(0, 40)
        .map(([key, item]) => [key, serializeUnknown(item, depth + 1)]),
    );
  }

  return String(value);
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: safeString(error.name, 'Error', 300),
      message: safeString(error.message, 'Unknown client error'),
      stack: safeString(error.stack, '', MAX_STRING_LENGTH) || undefined,
    };
  }

  return {
    name: 'NonError',
    message: safeString(typeof error === 'string' ? error : JSON.stringify(serializeUnknown(error)), 'Unknown client error'),
  };
}

function canSendReport(signature: string): boolean {
  const now = Date.now();

  if (!reportWindowStartedAt || now - reportWindowStartedAt > 60_000) {
    reportWindowStartedAt = now;
    reportCount = 0;
  }

  if (reportCount >= MAX_REPORTS_PER_MINUTE) return false;

  const recentAt = recentReports.get(signature);
  if (recentAt && now - recentAt < DEDUPE_WINDOW_MS) return false;

  reportCount += 1;
  recentReports.set(signature, now);

  for (const [key, seenAt] of recentReports) {
    if (now - seenAt > DEDUPE_WINDOW_MS) recentReports.delete(key);
  }

  return true;
}

function postReport(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon && body.length < 60_000) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(REPORT_ENDPOINT, blob)) return;
    }

    void fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Avoid recursive error reporting when the reporting endpoint is unreachable.
    });
  } catch {
    // Never let diagnostics create user-facing failures.
  }
}

export function reportClientError(error: unknown, context: ClientErrorReportContext = {}) {
  if (typeof window === 'undefined') return;

  const serialized = serializeError(error);
  const source = safeString(context.source, 'client');
  const signature = [
    source,
    serialized.name,
    serialized.message,
    serialized.stack?.slice(0, 500) || '',
    context.componentStack?.slice(0, 500) || '',
  ].join('|');

  if (!canSendReport(signature)) return;

  postReport({
    source,
    error: serialized,
    componentStack: safeString(context.componentStack, '', MAX_STRING_LENGTH) || undefined,
    extra: context.extra ? serializeUnknown(context.extra) : undefined,
    location: {
      href: safeString(window.location.href, '', 2000),
      pathname: safeString(window.location.pathname, '', 1000),
      search: safeString(window.location.search, '', 1000),
    },
    userAgent: safeString(window.navigator.userAgent, '', 1000),
    timestamp: new Date().toISOString(),
  });
}

export function installGlobalClientErrorHandlers() {
  if (typeof window === 'undefined') return () => undefined;

  const onError = (event: ErrorEvent) => {
    reportClientError(event.error ?? event.message, {
      source: 'window.error',
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, {
      source: 'window.unhandledrejection',
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}

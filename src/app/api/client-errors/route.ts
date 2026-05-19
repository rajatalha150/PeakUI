import { NextResponse } from 'next/server';
import { getCurrentAuth } from '@/lib/request-auth';

const MAX_BODY_BYTES = 70_000;
const MAX_STRING_LENGTH = 6000;
const MAX_DEPTH = 4;
const MAX_REPORTS_PER_MINUTE = 60;

type RateBucket = {
  windowStartedAt: number;
  count: number;
};

const rateBuckets = new Map<string, RateBucket>();

function safeString(value: unknown, fallback = '', maxLength = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes('password')
    || normalized.includes('secret')
    || normalized.includes('token')
    || normalized.includes('authorization')
    || normalized.includes('cookie')
    || normalized.includes('api_key')
    || normalized.includes('apikey');
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();

  if (depth >= MAX_DEPTH) return '[object]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record)
        .slice(0, 80)
        .map(([key, item]) => [key, shouldRedactKey(key) ? '[redacted]' : sanitizeValue(item, depth + 1)]),
    );
  }

  return String(value);
}

function getClientIp(req: Request): string {
  return safeString(
    req.headers.get('x-forwarded-for')?.split(',')[0]
    || req.headers.get('x-real-ip')
    || 'unknown',
    'unknown',
    200,
  );
}

function rateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);

  if (!bucket || now - bucket.windowStartedAt > 60_000) {
    rateBuckets.set(key, { windowStartedAt: now, count: 1 });
    return true;
  }

  if (bucket.count >= MAX_REPORTS_PER_MINUTE) return false;

  bucket.count += 1;

  for (const [bucketKey, value] of rateBuckets) {
    if (now - value.windowStartedAt > 120_000) rateBuckets.delete(bucketKey);
  }

  return true;
}

async function readPayload(req: Request): Promise<unknown> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new Error('Client error report body too large');
  }

  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const clientIp = getClientIp(req);
    const auth = await getCurrentAuth().catch(() => null);
    const rateKey = auth?.user.id ? `user:${auth.user.id}` : `ip:${clientIp}`;

    if (!rateLimit(rateKey)) {
      return NextResponse.json({ ok: true, rateLimited: true, requestId });
    }

    const payload = sanitizeValue(await readPayload(req));
    const logPayload = {
      requestId,
      userId: auth?.user.id ?? null,
      username: auth?.user.username ?? null,
      role: auth?.user.role ?? null,
      clientIp,
      userAgent: safeString(req.headers.get('user-agent'), '', 1000),
      referer: safeString(req.headers.get('referer'), '', 2000),
      payload,
      receivedAt: new Date().toISOString(),
    };

    console.error('[client-error]', JSON.stringify(logPayload, null, 2));
    return NextResponse.json({ ok: true, requestId });
  } catch (error) {
    console.error('[client-error] failed to record client report:', error);
    return NextResponse.json({ ok: false, requestId }, { status: 400 });
  }
}

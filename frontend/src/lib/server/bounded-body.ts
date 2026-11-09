/**
 * Bounded request body reading.
 *
 * `await request.text()` buffers whatever the client sends before anything can
 * measure it, so a size check performed afterwards never prevents the
 * allocation it exists to prevent. Every route that accepts a body reads it
 * through `readBoundedBody` instead, which
 *
 *   1. refuses an over-sized `Content-Length` before touching the stream, and
 *   2. drains the stream chunk by chunk, cancelling it the moment the running
 *      total passes the limit.
 *
 * Application buffering stops at the bounded prefix plus the incoming chunk
 * that exceeds the limit. This does not measure the HTTP runtime's buffering.
 */

export const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';
export const BODY_UNREADABLE = 'VALIDATION_ERROR';

export interface BoundedBodyOk {
  ok: true;
  text: string;
  bytes: number;
}

export interface BoundedBodyError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type BoundedBodyResult = BoundedBodyOk | BoundedBodyError;

/**
 * Strict `Content-Length` parse. A malformed, negative or multi-value header
 * yields null, which means "unknown" rather than "zero": the streaming limit
 * below is the real enforcement and must still run.
 */
export function declaredBodyBytes(header: string | null | undefined): number | null {
  if (typeof header !== 'string') return null;
  const value = header.trim();
  if (!/^\d{1,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function tooLarge(limitBytes: number): BoundedBodyError {
  return {
    ok: false,
    status: 413,
    code: PAYLOAD_TOO_LARGE,
    message: `Request body exceeds the ${limitBytes} byte limit.`,
  };
}

function unreadable(): BoundedBodyError {
  return {
    ok: false,
    status: 400,
    code: BODY_UNREADABLE,
    message: 'Request body could not be read.',
  };
}

/**
 * Reads at most `limitBytes` from the request body.
 *
 * The limit is applied to raw bytes, not decoded characters, so a multi-byte
 * payload cannot slip past it.
 */
export async function readBoundedBody(
  request: Request,
  limitBytes: number,
): Promise<BoundedBodyResult> {
  const declared = declaredBodyBytes(request.headers.get('content-length'));
  if (declared !== null && declared > limitBytes) {
    // Rejected without reading a single byte of the payload.
    return tooLarge(limitBytes);
  }

  const stream = request.body;
  if (!stream) {
    // No body to read: a GET, or a runtime that exposes an empty body as null.
    return { ok: true, text: '', bytes: 0 };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > limitBytes) {
        // Stop the transfer instead of draining the rest of it.
        await reader.cancel().catch(() => {});
        return tooLarge(limitBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    await reader.cancel().catch(() => {});
    return unreadable();
  }

  return { ok: true, text, bytes };
}

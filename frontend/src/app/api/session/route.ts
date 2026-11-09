import { handleSession } from '../../../lib/server/session';

// Session state is per-request and must never be cached or statically rendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handleSession(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleSession(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleSession(request);
}

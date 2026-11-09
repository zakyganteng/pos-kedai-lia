import { handlePosProxy } from '../../../../lib/server/pos-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return handlePosProxy(request, path ?? [], {});
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return handlePosProxy(request, path ?? [], {});
}

export const PATCH = POST;
export const DELETE = POST;

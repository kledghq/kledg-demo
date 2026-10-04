import { NextResponse } from 'next/server'
import { isDemoMode, DEMO_QONTO_API_PATH } from '@/lib/demo'
import { handleDemoQontoRequest } from '@/lib/demo/qonto/api'
import { touchSandboxByKey } from '@/lib/demo/sandbox/activity'

export const dynamic = 'force-dynamic'

/**
 * Simulated Qonto API, only served when KLEDG_DEMO_MODE=true. The demo
 * instance points QONTO_API_URL here (see lib/demo/qonto/api.ts). Each
 * sandbox company authenticates with its own credentials; a call counts as
 * activity of that sandbox.
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path = [] } = await params
  // Anonymous callers are refused first, like every route of Kledg (route
  // coverage guard, lib/__tests__/security/route-coverage.test.ts); only
  // receipt files are fetched without credentials (lib/demo/qonto/api.ts).
  if (path[0] !== 'files' && !request.headers.get('authorization')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const result = handleDemoQontoRequest({
    method: request.method,
    path,
    searchParams: url.searchParams,
    authorization: request.headers.get('authorization'),
    baseUrl: `${url.origin}${DEMO_QONTO_API_PATH}`,
  })
  if (result.tenant) await touchSandboxByKey(result.tenant.sandboxKey)

  if ('body' in result) {
    return new Response(new Uint8Array(result.body), {
      status: result.status,
      headers: { 'Content-Type': result.contentType, 'Cache-Control': 'private, max-age=3600' },
    })
  }
  return NextResponse.json(result.json, { status: result.status })
}

export { handle as GET, handle as POST }

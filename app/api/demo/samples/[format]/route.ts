import { NotFoundError } from '@/lib/accounting/errors'
import { companyRoute } from '@/lib/api/route'
import { contentDisposition } from '@/lib/api/files'
import { demoCompany, demoSampleContext } from '@/lib/demo/samples-route'
import { buildSampleFile, SAMPLE_FORMATS, type SampleFormat } from '@/lib/demo/samples'

export const dynamic = 'force-dynamic'

/** One sample statement file of a demo company, generated for today (demo instance only). */
export const GET = companyRoute({ company: demoCompany, permission: { banking: ['read'] } }, async ({ companyId, params }) => {
  const format = params.format
  if (typeof format !== 'string' || !(SAMPLE_FORMATS as readonly string[]).includes(format)) {
    throw new NotFoundError('Format inconnu')
  }
  const { profile, today } = await demoSampleContext(companyId)
  const file = buildSampleFile(profile, format as SampleFormat, today)
  return new Response(file.content, {
    headers: {
      'Content-Type': `${file.mimeType}; charset=utf-8`,
      'Content-Disposition': contentDisposition(file.fileName, 'attachment'),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
})

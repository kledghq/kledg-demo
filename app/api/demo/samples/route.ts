import { NextResponse } from 'next/server'
import { companyRoute } from '@/lib/api/route'
import { demoCompany, demoSampleContext } from '@/lib/demo/samples-route'
import { SAMPLE_FORMATS, sampleFileInfo, sampleLines } from '@/lib/demo/samples'
import { touchSandbox } from '@/lib/demo/sandbox/activity'

export const dynamic = 'force-dynamic'

/**
 * Sample statement files of a demo company (demo instance only, 404
 * elsewhere): names, download URLs and the bank account they belong to.
 * Loaded by the samples panel on each company page: records the sandbox's
 * activity.
 */
export const GET = companyRoute({ company: demoCompany, permission: { banking: ['read'] } }, async ({ companyId, user }) => {
  const { profile, bankAccountId, today } = await demoSampleContext(companyId)
  await touchSandbox(user)
  const lines = sampleLines(profile, today)
  return NextResponse.json({
    bankAccountId,
    today,
    lines: { existing: lines.filter((l) => l.existing).length, new: lines.filter((l) => !l.existing).length },
    files: SAMPLE_FORMATS.map((format) => ({
      ...sampleFileInfo(format, profile.engine.slug, today),
      url: `/api/demo/samples/${format}?companyId=${encodeURIComponent(companyId)}`,
    })),
  })
})

import Link from 'next/link'
import { CircleArrowUp, Database, Layers } from 'lucide-react'
import { requireAdminPersona } from '@/lib/demo/admin/page-guard'
import { DEMO_INSTANCE_LINKS } from '@/lib/demo/admin/links'
import { demoInstanceStatus } from '@/lib/demo/admin/instance.service'
import { DateDisplay, PageHeader, StatusBadge } from '@/components/shared'
import { Card, CardContent } from '@/components/ui/card'
import { PLATFORM_LABELS } from '@/lib/updates/hosting'

export const dynamic = 'force-dynamic'
export const metadata = { title: "État de l'instance" }


function StatusRow({ icon: Icon, title, status, children }: { icon: typeof Database; title: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span aria-hidden className="bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {status}
        </div>
        <div className="text-muted-foreground max-w-prose space-y-1 text-sm">{children}</div>
      </div>
    </li>
  )
}

/** "État de l'instance" of the Administrateur persona: harmless real checks. */
export default async function DemoInstancePage() {
  await requireAdminPersona()
  const status = await demoInstanceStatus()
  const { version, migrations } = status

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader title="État de l'instance" description="La base de données, la version installée et les migrations." />
      <Card>
        <CardContent>
          <ul className="divide-y">
            <StatusRow
              icon={Database}
              title="Base de données"
              status={status.database ? <StatusBadge tone="success">Accessible</StatusBadge> : <StatusBadge tone="danger">Inaccessible</StatusBadge>}
            >
              <p>PostgreSQL répond aux requêtes de Kledg.</p>
            </StatusRow>
            <StatusRow icon={CircleArrowUp} title="Version" status={<StatusBadge tone="neutral">{PLATFORM_LABELS[version.platform]}</StatusBadge>}>
              <p>
                Kledg <span className="num text-foreground">v{version.version}</span>
                {version.commit ? <span className="num"> · {version.commit.slice(0, 7)}</span> : null}
                {version.buildDate ? (
                  <>
                    , construite le <DateDisplay value={version.buildDate} format="long" />
                  </>
                ) : null}
                .
              </p>
              <p>
                <Link href={DEMO_INSTANCE_LINKS.updates} className="text-link underline-offset-4 hover:underline">
                  Voir les mises à jour
                </Link>
              </p>
            </StatusRow>
            <StatusRow
              icon={Layers}
              title="Migrations"
              status={
                migrations.failed > 0 ? (
                  <StatusBadge tone="danger">En échec</StatusBadge>
                ) : (
                  <StatusBadge tone="success">À jour</StatusBadge>
                )
              }
            >
              <p>
                <span className="num">{migrations.applied}</span> migrations appliquées
                {migrations.latest ? (
                  <>
                    , la dernière&nbsp;: <span className="text-foreground font-mono text-xs">{migrations.latest.name}</span>
                  </>
                ) : null}
                .
              </p>
            </StatusRow>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

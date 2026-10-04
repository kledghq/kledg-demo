import { Github, KeyRound, RefreshCw } from 'lucide-react'
import { DEMO_UNAVAILABLE, requireAdminPersona } from '@/lib/demo/admin/page-guard'
import { demoReleases } from '@/lib/demo/admin/instance.service'
import { getDeployedVersion } from '@/lib/updates/version'
import { DateDisplay, PageHeader, StatusBadge } from '@/components/shared'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UnavailableButton } from '@/components/demo/admin/unavailable-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mises à jour' }

/** "Mises à jour" of the Administrateur persona: the deployed version and recent releases; actions disabled. */
export default async function DemoUpdatesPage() {
  await requireAdminPersona()
  const deployed = getDeployedVersion()
  const releases = demoReleases(deployed.version)

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Mises à jour"
        description="La version installée de Kledg et les dernières versions publiées."
        actions={
          <UnavailableButton reason={DEMO_UNAVAILABLE} size="default">
            <RefreshCw aria-hidden />
            Rechercher une mise à jour
          </UnavailableButton>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Version installée</CardTitle>
          <CardDescription>
            Kledg <span className="num text-foreground">v{deployed.version}</span>
            {deployed.commit ? <span className="num"> · {deployed.commit.slice(0, 7)}</span> : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <UnavailableButton reason={DEMO_UNAVAILABLE}>
            <Github aria-hidden />
            Connecter GitHub
          </UnavailableButton>
          <UnavailableButton reason={DEMO_UNAVAILABLE}>
            <KeyRound aria-hidden />
            Ajouter un jeton
          </UnavailableButton>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Versions publiées</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="divide-y">
            {releases.map((release, index) => (
              <li key={release.version} className="space-y-1.5 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="num text-sm font-semibold">v{release.version}</h2>
                  <span className="text-muted-foreground text-sm">{release.title}</span>
                  {index === 0 ? <StatusBadge tone="success">Installée</StatusBadge> : null}
                  <DateDisplay value={release.date} format="long" className="text-muted-foreground ml-auto text-xs" />
                </div>
                <ul className="text-muted-foreground list-inside list-disc space-y-0.5 text-sm">
                  {release.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

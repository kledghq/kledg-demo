import { Ban, LogIn, Trash2, UserPlus } from 'lucide-react'
import { DEMO_UNAVAILABLE, requireAdminPersona } from '@/lib/demo/admin/page-guard'
import { listSandboxUsers } from '@/lib/demo/admin/instance.service'
import { DateDisplay, PageHeader, StatusBadge } from '@/components/shared'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UnavailableButton } from '@/components/demo/admin/unavailable-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Utilisateurs' }

/** "Utilisateurs" of the Administrateur persona: the accounts of the visitor's own demo, read only. */
export default async function DemoUsersPage() {
  const user = await requireAdminPersona()
  const users = await listSandboxUsers(user)

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Utilisateurs"
        description="Les comptes de cette instance&nbsp;: rôle, blocage et suppression."
        actions={
          <UnavailableButton reason={DEMO_UNAVAILABLE} variant="default" size="default">
            <UserPlus aria-hidden />
            Créer un compte
          </UnavailableButton>
        }
      />
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead className="hidden sm:table-cell">Créé le</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="max-w-56">
                    <div className="truncate font-medium">{u.name}</div>
                    <div className="text-muted-foreground truncate text-xs">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {u.isSelf ? <StatusBadge tone="info">Administrateur</StatusBadge> : <StatusBadge tone="neutral">Utilisateur</StatusBadge>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <DateDisplay value={u.createdAt} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {u.isSelf ? (
                        <span className="text-muted-foreground text-xs">Vous</span>
                      ) : (
                        <>
                          <UnavailableButton reason={DEMO_UNAVAILABLE} variant="ghost" size="icon-sm" label="Se connecter en tant que">
                            <LogIn aria-hidden />
                          </UnavailableButton>
                          <UnavailableButton reason={DEMO_UNAVAILABLE} variant="ghost" size="icon-sm" label="Bloquer">
                            <Ban aria-hidden />
                          </UnavailableButton>
                          <UnavailableButton reason={DEMO_UNAVAILABLE} variant="ghost" size="icon-sm" label="Supprimer">
                            <Trash2 aria-hidden />
                          </UnavailableButton>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

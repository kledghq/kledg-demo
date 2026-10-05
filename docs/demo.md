# Instance de démonstration (kledg-demo)

`kledghq/kledg-demo` est un fork de `kledghq/kledg` qui sert https://demo.kledg.com. Kledg ne connaît pas la démo : le fork s'y branche uniquement par les points d'extension de Kledg ([extension-points.md](extension-points.md)) et ajoute ses propres fichiers.

## Ce que fait la démo

Avec `KLEDG_DEMO_MODE=true`, chaque visiteur a sa **démo privée** (un « bac à sable ») :

- sur `/login`, le visiteur choisit son profil, **Dirigeant**, **Expert-comptable** ou **Administrateur** (voir [Trois profils](#trois-profils-dirigeant-expert-comptable-et-administrateur)), puis le bouton **Entrer dans la démo** crée un compte temporaire (`visiteur-<clé>@demo.kledg.com`, nom « Visiteur », mot de passe aléatoire jamais affiché), lui crée sa propre copie des quatre sociétés avec le rôle du profil choisi et le connecte. La carte affiche les étapes pendant la préparation (2 à 3 s en local, 3 à 5 s attendues sur Neon). Un visiteur déjà dans sa démo y retourne au lieu d'en créer une autre (s'il choisit un autre profil, sa démo est recréée avec ce profil, la carte le prévient) ;
- quatre sociétés fictives proches des cas courants, qui forment un petit groupe : Lumen Holding (SAS holding) détient 100 % d'Atelier Lumen (SASU de services à l'IS, TVA au réel normal) et de Maison Verdier (EURL commerçante) et 40 % de SCI Les Tilleuls (SCI à l'IS, affichée « Les Tilleuls » avec l'étiquette SCI), voir [Le groupe Lumen](#le-groupe-lumen) ; chacune avec l'exercice 2025 comptabilisé et clôturé et l'exercice 2026 tenu jusqu'à la fin de l'avant-dernier mois. Leurs slugs portent la clé de la démo (`atelier-lumen-k3x9ab`) et leurs numéros SIREN sont tirés pour chaque démo ;
- des règles d'affectation par société, toutes explicites (activée, priorité, application automatique) : les paiements récurrents et sans ambiguïté (loyer, abonnements, frais bancaires, assurance, URSSAF, TVA, client régulier, frais de gestion du groupe) s'appliquent à « Actualiser et rapprocher », les dépenses variables (carburant, fournitures, déplacements) sont proposées pour une application en un clic ;
- des comptes bancaires nommés « Compte principal Qonto » et associés au compte 5121 (comptes en euros), sur lequel le grand livre enregistre la banque ; tous ont le numéro de compte 00000000001 (les sociétés diffèrent par le guichet), si bien que le relevé OFX d'exemple de Kledg (`public/examples/exemple-releve.ofx`) correspond au compte de la démo ;
- la TVA du carburant de la voiture de tourisme d'Atelier Lumen est déductible à 80 % (CGI art. 298-4-1°, BOFiP BOI-TVA-DED-30-30-20), celle des billets de train et des courses VTC ne l'est pas (CGI annexe II art. 206, IV-2-3°) : le reste demeure en charge ;
- une API Qonto simulée servie par l'instance elle-même (`/api/demo/qonto/v2`) : chaque société de chaque démo a ses propres identifiants (`demo-<clé>`, `demo-maison-verdier-<clé>`, ...), dont la clé secrète est dérivée de la clé de l'instance et stockée chiffrée dans l'intégration Qonto de la société. « Actualiser et rapprocher » fonctionne donc pour chaque visiteur indépendamment. Les transactions sont générées de façon déterministe à partir de la date, 1 à 3 par jour ouvré, si bien que chaque synchronisation fait apparaître les opérations du jour ; les identifiants des justificatifs sont propres à chaque démo ;
- un bandeau « Démo privée · Dirigeant » (ou « · Expert-comptable », « · Administrateur »), « réinitialisée automatiquement après 24 h d'inactivité » (sur petit écran, une seule ligne avec le profil et un bouton **Détails** qui déplie le reste), avec le bouton **Réinitialiser ma démo** : après confirmation (une fenêtre courte : ce qui est conservé, ce qui est effacé, puis les étapes Suppression de vos données, Création des sociétés, Prêt), les sociétés du visiteur (écritures, relevés importés, rapprochements, règles, accès donnés aux assistants IA sur ces sociétés) sont effacées et recréées avec le même profil ; le compte, la session, les clés API et les connexions d'assistants sont conservés, et le visiteur arrive sur le tableau de bord de la première société. Le bouton **Changer de profil** ouvre la même fenêtre avec les trois profils (celui en cours marqué) et recrée de même la démo avec le profil choisi, avec un bouton neutre « Passer en ... » ;
- en bas à droite des pages d'une société, un panneau **Fichiers d'exemple** générés pour la société affichée (CSV, OFX, camt.053 et export BoursoBank) : la moitié des opérations existent déjà sur le compte avec un autre libellé (doublons probables), les autres sont nouvelles. La société est reconnue par l'identifiant de sa connexion Qonto (ou, à défaut, par son slug sans la clé de la démo) ;
- le changement de mot de passe ou d'email, la suppression du compte ou d'une société, la création d'une société (règle de Kledg, réservée aux administrateurs de l'instance, avec le message de la démo : `demoCompanyCreationRefusal`), l'invitation de membres, l'administration des utilisateurs, les mises à jour et la connexion d'une vraie banque sont refusés (les entrées de l'instance sont masquées des paramètres) ; aucun email n'est envoyé ; `/setup` redirige vers `/login` ; le démarrage guidé (`onboarding` : page d'accueil de l'instance, liste « Démarrer ») est refusé, les sociétés étant déjà créées et tenues. La page Profil reste accessible : changer d'email ou de mot de passe et supprimer le compte y sont désactivés avec le message de la démo, renommer le compte est permis ;

Sans `KLEDG_DEMO_MODE=true`, le fork se comporte exactement comme Kledg (développement local, CI, aperçus).

## Trois profils : dirigeant, expert-comptable et administrateur

| | Dirigeant | Expert-comptable | Administrateur |
|---|---|---|---|
| Rôle du visiteur dans les quatre sociétés | `companyAdmin` (Administrateur) | `accountant` (Comptable) | `companyAdmin` ; rôle de l'instance `user`, comme les autres profils |
| Autres membres | aucun | le dirigeant fictif de chaque société, `companyAdmin` : Claire Vasseur (Atelier Lumen et Lumen Holding), Thomas Verdier (Maison Verdier), Hélène Garnier (SCI Les Tilleuls) | les mêmes dirigeants fictifs |
| Exercice 2025 | clôturé partout | clôturé, sauf Lumen Holding : prêt à clôturer (ses à-nouveaux 2026 viennent avec la clôture) | comme le dirigeant |
| Exercice 2026 | écritures validées jusqu'à la fin de l'avant-dernier mois | écritures à partir du 16 du dernier mois tenu laissées en brouillon (numéro provisoire), à valider : environ 25 pour Atelier Lumen et Maison Verdier, quelques-unes pour la SCI et la holding (selon le mois) | comme le dirigeant |
| Transactions non rapprochées | celles après la fin des écritures, les mêmes pour les trois profils | | |

Toutes les écritures restent équilibrées ; les écritures validées gardent une numérotation continue, et la validation numérote les brouillons à la suite (PCG art. 1031-3). Le seed est le même (`seedDemoCompanies({ ownerId, sandboxKey, persona })`), seuls les rôles, les dirigeants fictifs, les brouillons et la clôture de la holding changent. Le profil se lit dans les rôles : `accountant` partout, expert-comptable ; `companyAdmin` avec les dirigeants fictifs, administrateur ; `companyAdmin` seul, dirigeant (`sandboxPersona`, `lib/demo/sandbox/membership.ts`).

### Frais de gestion, budgets, notes de frais et abonnements

Chaque démo reçoit aussi des données pour les fonctions de gestion de Kledg (`lib/demo/seed-features.ts`), les mêmes pour les trois profils :

- **Frais de gestion** (`lib/management-fees`) : Lumen Holding est actionnaire de ses filiales, l'entrée **Frais de gestion** apparaît donc dans la holding. Sa « Convention d'animation » (créée par le service des conventions) facture un forfait de 2 500 € HT par mois réparti à 60 % pour Atelier Lumen (1 500 €) et 40 % pour Maison Verdier (1 000 €), TVA 20 %, série `LH-<année>-<numéro>` (chaque mois, Atelier Lumen puis Maison Verdier : `LH-2026-015` et `LH-2026-016` pour août). La holding facture le premier jour du mois (journal VE : 411 avec le compte auxiliaire de la filiale, C00001 ou C00002, 706, 44571 ; la holding a opté pour la TVA sur les débits), chaque filiale enregistre la facture reçue (journal AC : 6226, 44566, 401 avec le compte auxiliaire F00001 de la holding) et paie le 25 (même référence des deux côtés). Chaque mois tenu (tout 2025, 2026 jusqu'à l'avant-dernier mois) a, par filiale, sa facture de vente dans la holding et sa facture d'achat dans la filiale liées à leurs écritures, sa facturation (montants du moteur `lib/management-fees/compute.ts`), leurs règlements et leurs lettrages ; le dernier mois écoulé et le mois en cours restent à calculer et facturer par le visiteur, puis à rapprocher avec les virements (les règles « Frais de gestion Atelier Lumen » et « Frais de gestion Maison Verdier » soldent le 411 de la holding, « Frais de gestion Lumen Holding » le 401 de Maison Verdier). Chez l'expert-comptable, les virements du dernier mois tenu sont en brouillon : leurs factures attendent le règlement.
- **Budgets** (`lib/budgets`, `lib/demo/budgets.ts`) : un budget 2026 pour Atelier Lumen et Maison Verdier, montants mensuels tirés de 2025 (ventes en hausse de 8 % et 5 %), et des éléments récurrents (loyer, assurance, logiciels, rémunération de la présidente, frais de gestion des deux filiales, CFE) ; les comptes non budgétés (livres, dotations, impôt) apparaissent hors budget.
- **Notes de frais** (`lib/expense-reports`, `lib/demo/expense-reports.ts`) : Claire Vasseur, présidente salariée d'Atelier Lumen, bénéficiaire « dirigeant » au compte 421 (D00001), liée au visiteur pour le profil dirigeant (qui la joue), à son compte fictif sinon. NDF-0001 (mars 2026) est validée, comptabilisée et remboursée : son écriture est lettrée avec le virement du 8 avril 2026 que montre la banque simulée ; NDF-0002 (dernier mois écoulé) est soumise, à valider ; NDF-0003 (mois en cours) est un brouillon.
- **Abonnements** (`lib/subscriptions`) : rien n'est enregistré, ils sont détectés dans les opérations synchronisées (logiciels, télécoms, hébergement, loyer, assurance ; salaire, URSSAF et emprunt de la SCI en charges récurrentes).

### Le groupe Lumen

Tout le groupe est décrit en un seul endroit, `lib/demo/qonto/profiles/group.ts`, pour que les deux côtés de chaque flux passent la même chose ; la **Vue groupe** de la holding (`docs/vue-groupe.md`) le montre dans chaque démo, pour les trois profils.

- **Capital et détention** : Claire Vasseur a fondé Lumen Holding en juin 2024 en apportant ses 100 actions d'Atelier Lumen (120 000 €), avec son frère Marc Vasseur qui a apporté ses 40 parts de SCI Les Tilleuls (36 000 €) ; Thomas Verdier a apporté en décembre 2024 les 500 parts de Maison Verdier (84 000 €). Capital de la holding : 240 000 € (24 000 actions de 10 €), détenu par des personnes physiques (Claire Vasseur 50 %, Thomas Verdier 35 %, Marc Vasseur 15 %). Les titres sont aux sous-comptes 261100 « Titres Atelier Lumen », 261200 « Titres Maison Verdier » et 261300 « Titres SCI Les Tilleuls », à leur valeur d'apport ; les lignes d'actionnaires des filiales enregistrent la holding (100 %, 100 % et 40 % : deux filiales et une participation, Code de commerce art. L233-1 et L233-2). Maison Verdier reste une EURL (associée unique : la holding) ; Thomas Verdier en est le gérant non associé, à titre gratuit : elle ne verse ni salaire ni cotisations.
- **Personnes** (`lib/demo/people`) : Claire Vasseur (présidente de la holding et d'Atelier Lumen), Marc Vasseur, Thomas Verdier (gérant de Maison Verdier) et Hélène Garnier (gérante et associée à 60 % de la SCI) sont des personnes de chaque société où elles ont un rôle, actionnaires personnes physiques là où elles détiennent des parts, leur fonction en note. Leurs photos sont des visages générés par https://thispersondoesnotexist.com (aucune personne réelle), 256 x 256, enregistrés comme Kledg le fait (`Person.photo`, data URL). Kledg n'affiche pas encore ces photos (la liste des actionnaires montre le nom). Elles sont supprimées avec les sociétés de la démo.
- **Avance en compte courant** : la holding a prêté 15 000 € à Maison Verdier le 1er juillet 2025 (451100 « Compte courant Maison Verdier » chez la holding, 455100 « Compte courant Lumen Holding » chez la filiale), au taux de 4 % ; les intérêts sont facturés le 31 décembre (facture `CC-2025-001`, exonérée de TVA, 7638 chez la holding, 6615 chez la filiale) et payés à la mi-janvier.
- **Facture entre filiales** : Atelier Lumen a créé l'identité visuelle des coffrets cadeaux de Maison Verdier (facture `FA-2025-1006-MV`, 3 600 € HT, TVA sur les encaissements en 44574 jusqu'au règlement du 31 octobre 2025).
- **Dividendes** : Atelier Lumen verse 15 000 € en juin 2025 et 18 000 € en juin 2026, après l'approbation des comptes de l'année précédente et l'affectation du résultat (457, 110) ; la holding les reçoit en 761 (régime mère-fille).
- Chaque société tient un tiers pour les autres (SIREN de la démo), et les factures entre sociétés existent des deux côtés dans le module des factures. En 2025 comme en 2026, la vue groupe trouve les frais de gestion, les factures, les dividendes, le compte courant et la créance d'intérêts, et les élimine sans écart. Chez l'expert-comptable, l'exercice 2025 de la holding est encore ouvert : la vue groupe de 2025 est complète, celle de 2026 attend la clôture (les à-nouveaux de la holding, donc ses titres et son avance, viennent avec elle).

La facturation Qonto simulée répond des listes vides aux points d'accès des factures (`clients`, `client_invoices`, `supplier_invoices`) : « Importer depuis Qonto » n'importe rien, sans erreur. Tests : `lib/demo/__tests__/features.db.test.ts`, `lib/demo/__tests__/generator.test.ts` et `lib/demo/__tests__/people.test.ts`.

### Administrateur

Un visiteur n'est jamais administrateur de l'instance : toutes les démos partagent la même base, et un vrai administrateur verrait les démos des autres, pourrait prendre leur identité ou les bloquer et lancer des mises à jour. Le profil Administrateur reste donc un utilisateur ordinaire (rôle `user`, `isGlobalAdmin` faux) ; les contrôles de Kledg ne changent pas, et la politique de la démo refuse toutes les actions de l'instance (gestion des utilisateurs, mises à jour, installation, démarrage guidé, invitations, suppression de sociétés). Le groupe **Instance** des paramètres mène aux pages de la démo (`app/(account)/demo`, `lib/demo/admin`), reliées par le point d'extension `instanceSettingsLinks` :

- **État de l'instance** (`/demo/instance`) : base de données accessible, version installée, migrations appliquées ; aucune variable ni secret ;
- **Utilisateurs** (`/demo/users`) : les comptes de la démo du visiteur seulement (lui et ses dirigeants fictifs) ; créer, bloquer, prendre l'identité et supprimer sont affichés désactivés (« Non disponible dans la démo ») ;
- **Mises à jour** (`/demo/updates`) : la version déployée (`getDeployedVersion`) et une liste fixe des dernières versions ; rechercher une mise à jour, connecter GitHub et ajouter un jeton sont désactivés. La ligne de version du pied de la barre latérale y mène.

Ces pages répondent 404 à tout autre compte. Test : `lib/demo/__tests__/admin-persona.db.test.ts` (rôle `user`, pas de liste des autres démos, 403 sur les routes d'administration et les points d'accès d'administration de Better Auth).

Ce que l'expert-comptable peut faire, d'après les rôles de Kledg (`lib/permissions.ts`) : valider les écritures, saisir, gérer le plan comptable, les journaux et les règles d'affectation, rapprocher les opérations et synchroniser la banque, clôturer un exercice, consulter et exporter les états et le FEC. Ce qui lui est refusé (403 « Action non autorisée : votre rôle (Comptable) ne permet pas cette opération. ») : connecter, modifier ou supprimer une banque ou un compte bancaire, modifier les informations, établissements, actionnaires et présentations des états de la société. La gestion des membres est réservée à l'administrateur de l'instance pour tous les visiteurs (et l'invitation est refusée en mode démo).

Kledg montre ces actions à tous les membres et répond 403 ; la démo n'y touche pas et explique par ses points d'extension :

- le bandeau de l'expert-comptable a un bouton **Ce que vous pouvez faire** (ce qui est permis, ce qui est réservé au dirigeant) ;
- sur les pages Banque, Informations et Membres d'une société, une seconde ligne du bandeau dit ce que le rôle permet et ce qui sera refusé.

Les dirigeants fictifs ont leur propre domaine (`<prénom.nom>-<clé>@clients.demo.kledg.com`) : ils ne comptent pas comme des démos (plafond, recyclage, nettoyage portent sur `@demo.kledg.com`), n'ont aucun mot de passe (pas de ligne `credential`) et sont bannis : personne ne peut se connecter avec eux. Ils sont créés avec les sociétés et supprimés avec elles (réinitialisation, changement de profil, suppression de la démo).

Le profil n'est stocké nulle part ailleurs que dans les rôles : une démo dont le visiteur est `accountant` est une démo d'expert-comptable (`sandboxPersona`, `lib/demo/sandbox/membership.ts`).

## Isolation entre visiteurs

L'isolation repose sur les contrôles de Kledg eux-mêmes, sans exception pour la démo :

- un compte de démo est un utilisateur ordinaire (rôle `user`, jamais administrateur de l'instance) et `companyAdmin` ou `accountant` de ses quatre sociétés seulement. Pages, routes, serveur MCP et sélecteur de société ne lui montrent que ses sociétés ; une société d'un autre visiteur répond 404, par id comme par slug ;
- les dirigeants fictifs d'une démo d'expert-comptable ou d'administrateur ne sont membres que des sociétés de leur démo, et ne peuvent pas se connecter ;
- les assistants IA connectés en OAuth ou par clé API agissent pour ce compte : leurs accès (grants) sont ceux du visiteur ;
- l'API Qonto simulée refuse les identifiants d'une autre démo (la clé secrète d'une démo ne peut pas être calculée sans la clé de l'instance) ;
- les routes des fichiers d'exemple sont des routes de société (`companyRoute`) : 404 pour la société d'un autre visiteur ;
- l'ajout de membres est réservé aux administrateurs de l'instance et refusé en mode démo.

Tests : `lib/demo/__tests__/sandbox.db.test.ts` (création et connexion, deux démos créées en même temps, liste des sociétés, accès direct par id et par slug, fichiers d'exemple, identifiants Qonto d'une autre démo, réinitialisation, limites, nettoyage), `lib/demo/__tests__/accountant-sandbox.db.test.ts` (profil expert-comptable : rôles et dirigeants fictifs sans connexion possible, brouillons et exercice à clôturer, écritures équilibrées, actions permises et refusées par les routes de Kledg, réinitialisation qui garde le profil, changement de profil depuis le bandeau et la carte de connexion, isolation, nettoyage des dirigeants fictifs), `lib/demo/__tests__/persona.test.ts`, `lib/demo/__tests__/qonto-api.test.ts`, `lib/demo/__tests__/sandbox-identity.test.ts`, `components/demo/__tests__/personas.test.tsx`.

## Durée de vie, limites et nettoyage

| Variable (facultative) | Défaut | Rôle |
|---|---|---|
| `DEMO_MAX_SANDBOXES` | 200 | nombre maximal de démos en même temps |
| `DEMO_SANDBOX_TTL_HOURS` | 24 | une démo inactive depuis plus longtemps est supprimée par la tâche de nuit |
| `DEMO_SANDBOX_EVICT_IDLE_MINUTES` | 60 | au plafond, la démo la moins récemment utilisée, inactive depuis au moins ce délai, est recyclée pour le nouveau visiteur |
| `DEMO_SANDBOXES_PER_IP_PER_HOUR` | 5 | démos créées par adresse IP et par heure (table `rateLimit`, comme Better Auth) |

- **Activité** : la date de mise à jour du compte, rafraîchie (au plus toutes les 5 minutes) à l'affichage d'une page de l'application, au chargement du panneau des fichiers d'exemple et à chaque appel de l'API Qonto simulée par la démo ; les sessions rafraîchies par Better Auth comptent aussi.
- **Plafond** : l'admission est sérialisée par un verrou consultatif PostgreSQL, si bien que des visiteurs simultanés ne dépassent jamais le plafond ; les seeds, eux, tournent en parallèle. Au plafond, la démo inactive depuis le plus longtemps (au moins `DEMO_SANDBOX_EVICT_IDLE_MINUTES`) est supprimée pour faire de la place : une démo abandonnée vaut moins qu'un nouveau visiteur, et la base reste bornée. Si toutes les démos servent (activité récente), la création est refusée avec « La démo accueille beaucoup de visiteurs en ce moment : toutes les places sont occupées. Réessayez dans quelques minutes. » : recycler une démo active casserait la session d'un autre visiteur, et partager une démo romprait l'isolation.
- **Nettoyage** : la tâche planifiée `/api/cron/reset-demo` (03:00 UTC, protégée par `CRON_SECRET`, chemin conservé de la première version) supprime les démos inactives depuis plus de `DEMO_SANDBOX_TTL_HOURS` : utilisateur, dirigeants fictifs, sessions, comptes d'authentification, consentements et jetons OAuth, accès des assistants, clés API, et les sociétés avec tout ce qui en dépend (écritures, exercices, banque, relevés importés, justificatifs, règles, intégrations, adresses). Elle travaille par lots dans un budget de temps (le reste part la nuit suivante ou au prochain appel), supprime le compte partagé `demo@kledg.com` de la première version s'il existe encore, les sociétés restées sans membre (seed interrompu) depuis plus d'une heure, et les dirigeants fictifs dont le visiteur n'existe plus (avec les sociétés où ils restent seuls). Une démo active n'est jamais touchée. Le journal d'audit est en ajout seul (migration Kledg `20261011090000_audit_log_append_only`) : ses lignes ne sont pas supprimées, celles des sociétés supprimées restent, détachées (`companyId` remis à vide par la clé étrangère), jusqu'à la purge à 10 ans de Kledg (`kledg_purge_audit_logs`).
- **Suppression des sociétés** : Kledg refuse de supprimer une société qui a des écritures validées ou un exercice clôturé (déclencheur `companies_keep_books`, migration `20261011100000_company_archiving`). Les sociétés d'une démo sont des copies fictives : leur suppression (réinitialisation, changement de profil, recyclage, nettoyage) se fait dans une transaction qui active `kledg.closed_year_bypass` et `kledg.company_purge` (`deleteCompaniesInTx`, `lib/demo/sandbox/service.ts`). Le second réglage doit être reconnu par une migration de Kledg (le déclencheur l'ignore tant qu'elle n'est pas fusionnée) : sans elle, réinitialiser, changer de profil et nettoyer échouent.

## Taille et temps de création d'une démo

Mesures sur PostgreSQL local (`DEMO_SEED_SANDBOXES=5 pnpm demo:seed`) :

| | Par démo |
|---|---|
| Lignes | 13 460 (dont 3 690 comptes, 2 150 écritures, 6 120 lignes d'écriture, 420 transactions bancaires) |
| Taille (tables et index) | 6,9 Mo juste après la création, 5,5 Mo une fois les lignes mortes nettoyées (vacuum) |
| Requêtes SQL | 695 (insertions groupées) |
| Temps | 2,3 à 2,7 s en local ; 3,2 s avec 5 ms de latence par requête, 5 s avec 15 ms (`DEMO_SEED_SIMULATED_LATENCY_MS`) |

Une démo d'expert-comptable (`DEMO_SEED_PERSONA=accountant`) a la même taille à quelques lignes près (13 447 lignes, 6,8 Mo, 2,3 à 2,8 s en local) : trois dirigeants fictifs en plus, la clôture 2025 de la holding en moins.

L'exercice 2026 (ouvert) a le PCG complet ; l'exercice 2025 (clôturé) n'a que les comptes mouvementés et leurs parents, ce qui suffit à ses états, grands livres et FEC et économise environ un cinquième de la taille. Au plafond par défaut (200), la base des démos atteint environ 1,1 à 1,4 Go : sur l'offre gratuite de Neon (0,5 Go), réglez `DEMO_MAX_SANDBOXES` vers 60.

## Ce que le fork change par rapport à Kledg

Fichiers de Kledg modifiés (à garder minces : ce sont les seuls conflits possibles lors des fusions) :

| Fichier | Changement |
|---|---|
| `lib/instance/policy.ts` | délègue à `lib/demo/policy.ts` : actions refusées en mode démo, routes auto-authentifiées (API Qonto simulée, tâche de nettoyage) |
| `components/instance/slots.tsx` | bandeau (profil, « Ce que vous pouvez faire », « Changer de profil », « Réinitialiser ma démo »), carte de connexion avec le choix du profil, panneau des fichiers d'exemple, menu utilisateur filtré par la politique, pages d'instance de l'administrateur (`instanceSettingsLinks`) ; les actions serveur sont celles de `lib/demo/sandbox/actions.ts` |
| `app/(account)/layout.tsx`, `components/layout/settings-sidebar.tsx`, `components/layout/settings-breadcrumb.tsx`, `components/layout/settings-nav-config.ts` | le point d'extension `instanceSettingsLinks` (pages d'instance servies par l'instance à un non-administrateur), à reporter dans Kledg |
| `vercel.json` | tâche planifiée `/api/cron/reset-demo` (03:00 UTC) |
| `package.json` | script `demo:seed` |
| `README.md` | section kledg-demo |

Fichiers ajoutés : `lib/demo/**` (mode, politique, démos privées `sandbox/`, seed, sociétés, moteur et API Qonto simulés, fichiers d'exemple), `app/api/demo/**` (API Qonto simulée, fichiers d'exemple), `app/(account)/demo/**` (pages d'instance du profil Administrateur), `app/api/cron/reset-demo`, `scripts/seed-demo.ts`, `components/demo/**` (bandeau, carte de connexion et choix du profil, boutons de réinitialisation et de changement de profil, note et indications de l'expert-comptable, panneau), leurs tests, `.github/workflows/sync-upstream.yml` et ce document.

Le seed d'une démo (`seedDemoCompanies({ ownerId, sandboxKey })`) écrit par lots et fait la première synchronisation Qonto en appelant l'API simulée dans le processus, par un fournisseur bancaire injecté dans `syncIntegration` (`lib/demo/qonto/provider.ts`) : aucun appel HTTP, rien de global n'est modifié, plusieurs démos peuvent être créées en même temps. La connexion du visiteur passe par `auth.api.signInEmail` côté serveur, dont les cookies sont recopiés sur la réponse de l'action : aucun plugin n'est ajouté à Kledg.

`.github/workflows/update-from-kledg.yml` reste identique à Kledg (ses tests le lisent) mais ne doit pas tourner ici : la synchronisation le désactive à chaque exécution.

## Variables d'environnement (projet Vercel kledg-demo)

| Variable | Valeur |
|---|---|
| `KLEDG_DEMO_MODE` | `true` (le drapeau propre au fork : sans lui, aucune démo n'est créée ni supprimée) |
| `QONTO_API_URL` | `https://demo.kledg.com/api/demo/qonto/v2` (l'API simulée de l'instance ; Kledg utilise cette variable telle quelle) |
| `CRON_SECRET` | secret partagé avec les tâches planifiées (Vercel l'envoie) |
| `DEMO_MAX_SANDBOXES`, `DEMO_SANDBOX_TTL_HOURS`, `DEMO_SANDBOX_EVICT_IDLE_MINUTES`, `DEMO_SANDBOXES_PER_IP_PER_HOUR` | facultatives, voir plus haut |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | comme toute instance Kledg ([configuration.md](configuration.md)) ; changer `BETTER_AUTH_SECRET` (ou `ENCRYPTION_KEY`) invalide les identifiants Qonto des démos existantes |

Pas de `RESEND_API_KEY` nécessaire : la politique refuse l'envoi d'emails. `QONTO_API_URL` doit être absolue ; sur un aperçu Vercel, réglez-la sur l'URL de l'aperçu (la clé secrète des identifiants dépend de la clé de chaque instance).

## Remettre la base à zéro

```bash
KLEDG_DEMO_MODE=true pnpm demo:seed                         # efface toute la base (toutes les démos)
KLEDG_DEMO_MODE=true DEMO_SEED_SANDBOXES=5 pnpm demo:seed   # puis crée 5 démos et mesure temps, lignes et taille
KLEDG_DEMO_MODE=true DEMO_SEED_SANDBOXES=5 DEMO_SEED_PERSONA=accountant pnpm demo:seed   # idem, démos d'expert-comptable
```

## Synchronisation avec Kledg

`.github/workflows/sync-upstream.yml` fusionne chaque jour (et à la demande) `kledghq/kledg` main dans main. Si la fusion est propre et que `pnpm typecheck`, `lint`, `test:run` et `build` passent, il pousse main, ce qui redéploie la démo (les migrations s'appliquent au build). En cas de conflit ou d'échec, rien n'est poussé et une issue `upstream-sync` est ouverte avec le détail ; la synchronisation suivante réussie la ferme.

Secret requis : `UPSTREAM_SYNC_TOKEN`, un jeton fine-grained (propriétaire `kledghq`, dépôts `kledghq/kledg` et `kledghq/kledg-demo`) avec **Contents : Read and write** et **Workflows : Read and write**. Le `GITHUB_TOKEN` des Actions ne suffit pas : il ne lit pas un autre dépôt privé et ne peut pas pousser une fusion qui modifie `.github/workflows`. Pour réduire les droits, une GitHub App installée sur les deux dépôts (Contents et Workflows en écriture sur kledg-demo, Contents en lecture sur kledg) peut fournir ce jeton.

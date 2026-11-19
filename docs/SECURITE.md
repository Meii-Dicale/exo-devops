# Sécurité de TaskFlow

Les contrôles de sécurité du projet, le triage des alertes, les corrections, et le **registre des exceptions**.
À mettre à jour à chaque alerte traitée. Plan repris de `solution/docs/SECURITE.md` (formation), contenu propre au projet.

## 1. Les contrôles et leur place dans le pipeline

| Contrôle | Outil | Où | Quand | Ce qu'il protège |
| --- | --- | --- | --- | --- |
| Secrets (avant commit) | **gitleaks** v8.30.1 (hook pre-commit) | poste | `git commit` | un secret qui part dans un commit |
| Secrets (historique) | **gitleaks** v8.30.1, binaire vérifié par SHA-256 | `security.yml` › `secrets` | PR, push `main`, lundi, manuel | un secret déjà dans l'historique (le hook se contourne) |
| Dépendances (SCA) | **npm audit** `--audit-level=high`, api et front | `security.yml` › `dependances` | PR, push `main`, **lundi** | une dépendance avec une CVE connue |
| Dépendances (veille) | **Dependabot** | `.github/dependabot.yml` | chaque semaine | des dépendances qui vieillissent |
| Code (SAST) | **Semgrep** 1.184.0 (`p/javascript`, `p/nodejsscan`, `--error`) | `security.yml` › `sast` | PR, push `main`, lundi | injection SQL, XSS, `eval`, secrets en dur |
| Application (DAST) | **ZAP baseline** 2.17.0 + `.zap/rules.tsv` | `security.yml` › `dast` | PR, push `main`, lundi | en-têtes, fuites d'information, cookies |
| Image (SCA) | **Trivy** (bloquant sur CRITICAL corrigeable, `ignore-unfixed`) | `release.yml` | push `main` | une CVE dans l'image publiée |
| Configuration IaC | `tofu validate` / `plan` (drift) | `iac.yml` | PR, planifié | une infra qui dérive du code |
| Durcissement HTTP | en-têtes **Nginx** | `front/nginx.conf`, proxy | chaque requête | XSS, clickjacking, fuite de version |
| Moindre privilège | `permissions: contents: read`, actions **épinglées par SHA** | tous les workflows | toujours | un jeton détourné, une action modifiée après coup |

**Pourquoi le `schedule` hebdomadaire** : le code ne change pas, mais les bases de CVE si. Une dépendance saine lundi
peut avoir une faille publiée mardi ; seul un scan planifié le voit sans attendre la prochaine PR.

## 2. Triage des alertes (19/11/2026)

Premier passage de `security.yml` sur `main` (avant correction). Les 4 questions : atteignable en prod ? données
utilisateur ? impact ? décision ?

| Alerte | Outil | Sévérité | Vrai / faux positif | Décision |
| --- | --- | --- | --- | --- |
| Content Security Policy (CSP) Header Not Set [10038] | ZAP | Medium | **vrai** | corrigé : CSP stricte dans `front/nginx.conf` |
| Missing Anti-clickjacking Header [10020] | ZAP | Medium | **vrai** | corrigé : `X-Frame-Options DENY` + `frame-ancestors 'none'` |
| nginx Version with Known Vulnerabilities [20020] (1.29.8) | ZAP | High | **vrai** : la branche 1.29 n'a plus de correctifs | corrigé : `nginx:1.30-alpine` (stable) pour le front **et** le proxy, version masquée |
| Server Leaks Version Information [10036] | ZAP | Low | **vrai** | corrigé : `server_tokens off` (front et proxy) |
| X-Content-Type-Options Header Missing [10021] | ZAP | Low | **vrai** | corrigé : `nosniff` |
| Permissions Policy Header Not Set [10063] | ZAP | Low | **vrai** | corrigé |
| Cross-Origin-{Embedder,Opener,Resource}-Policy [90004] | ZAP | Low | **vrai**, impact faible (aucune ressource tierce) | corrigé : coût nul, le site ne charge que ses fichiers |
| `X-Powered-By: Express` sur `/api/*` (vu au `curl`, ZAP n'explore pas l'API) | manuel | Low | **vrai** | corrigé : `proxy_hide_header X-Powered-By` |
| Storable and Cacheable Content [10049] | ZAP | Info | **faux positif** : pages publiques, aucune donnée utilisateur dans le HTML | IGNORE justifié (§ 5) |
| Modern Web Application [10109] | ZAP | Info | information, pas une faille | IGNORE justifié (§ 5) |
| `body-parser` < 1.20.9 (via `express`, api) | npm audit | **high** | **vrai** et **atteignable en prod** : il lit chaque corps de requête | corrigé : `npm audit fix` → 1.20.9 |
| `vitest`, `@vitest/coverage-v8`, `tinypool` (api, front) | npm audit | critical | **vrai**, mais **devDependencies** : absents des images | corrigé : vitest 4.1.12 (voir § 4) |
| `vite` ≤ 6.4.3 (front direct, api transitif) | npm audit | high | **vrai**, serveur de dev et build seulement | corrigé : vite 8.3.8 |
| `esbuild`, `glob`, `minimatch`, `test-exclude`, `vite-node`, `@vitest/mocker` | npm audit | moderate | vrai, outils de dev | corrigés par les montées ci-dessus |
| Node.js 20 en fin de vie (30/04/2026) | constat (vitest 5 exige Node ≥ 22.12) | élevée | **vrai** : le runtime de l'API ne reçoit plus de correctifs | **issue [#25](https://github.com/Meii-Dicale/exo-devops/issues/25)** (images, CI, ruleset) |
| Semgrep | SAST | - | 0 résultat (14 fichiers) | rien à faire |
| gitleaks | secrets | - | 0 fuite (historique complet) | rien à faire |

Après correction : `npm audit` **0 vulnérabilité** (api et front), ZAP **0 FAIL, 0 WARN** (66 PASS).

## 3. Durcissement HTTP (en-têtes du front)

Posés dans [`front/nginx.conf`](../front/nginx.conf), au niveau `server`, avec `always` (aussi sur les 404 et 502).
En production, ils traversent le proxy HTTPS ([`deploy/nginx/taskflow.conf`](../deploy/nginx/taskflow.conf)).

| En-tête | Valeur | Rôle |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | seules nos propres ressources ; bloque l'essentiel des XSS (script injecté, `eval`, style inline) |
| `X-Content-Type-Options` | `nosniff` | le navigateur ne « devine » pas un type (un JS déguisé en image) |
| `X-Frame-Options` | `DENY` | anti-clickjacking pour les navigateurs qui ignorent `frame-ancestors` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | l'URL complète ne part pas vers les autres sites |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | fonctions du navigateur inutiles : refusées |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` / `-Embedder-Policy` | `same-origin` / `same-origin` / `require-corp` | isolation entre origines |

Aussi : `server_tokens off` (front **et** proxy : `Server: nginx`, sans version) et `proxy_hide_header X-Powered-By`.

**Pas de `'unsafe-inline'`** : `dist/index.html` ne contient que `<script src>` et `<link href>` vers `/assets/`
(vérifié avec vite 5 puis vite 8). Le JS construit le DOM avec `textContent`, sans `innerHTML` ni attribut `style`.

**Vérifié dans Chrome (headless, protocole DevTools)** : chargement, création d'une tâche, case cochée, feuille de
style chargée, **aucune violation CSP ni erreur console**. Le même script détecte bien une violation quand on injecte
volontairement un `style` inline : le test n'est pas aveugle.

> **Piège Nginx** : `add_header` **n'est pas hérité** par une `location` qui a son propre `add_header`. Le
> `Cache-Control` des assets est donc posé par un `map $uri` en tête de fichier, et `location /assets/` n'a aucun
> `add_header`. Vérifié par `curl -I` sur `/`, `/health`, `/api/tasks`, un fichier `/assets/*.js` et un asset absent (404).

`location /assets/` renvoie aussi un **404** pour un fichier absent, au lieu de `index.html` servi comme du JS.

## 4. Dépendances

- **api** : `body-parser` (dépendance d'`express`) était la seule faille **de production** : corrigée sans montée
  majeure. Les autres alertes concernaient les outils de test.
- **front** : uniquement des `devDependencies`. Le livrable est un dossier de fichiers statiques servi par Nginx : aucun
  code npm ne tourne en production. On corrige quand même, car ces outils s'exécutent dans la CI et sur les postes
  (un serveur de dev vulnérable expose le poste du développeur).
- **vitest 4.1.12 et non 5** : vitest 5 exige Node ≥ 22.12, or l'API est testée et livrée sur Node 20 (check
  obligatoire `api (20)`). La 4.1.12 corrige les mêmes failles en restant compatible. Le vrai sujet, Node 20 en fin
  de vie, est suivi dans [#25](https://github.com/Meii-Dicale/exo-devops/issues/25).
- Contrôles après montée : tests (api 38, front 7), couverture api 88,7 % (seuil 75 %), lint, Prettier,
  `npm run build`, et l'image du front reconstruite et testée dans le navigateur.

## 5. Registre des exceptions

Chaque exception est **étroite** (une règle, un chemin), **justifiée**, **datée** et a une date de revue. Un vrai
secret ne s'ajoute jamais ici : on le **révoque** (§ 7).

### ZAP : [`.zap/rules.tsv`](../.zap/rules.tsv)

| Règle | Action | Pourquoi | Qui | Ajoutée | Revue |
| --- | --- | --- | --- | --- | --- |
| 10049 Storable and Cacheable Content | IGNORE | `/`, `/robots.txt`, `/sitemap.xml` sont publics et identiques pour tous : aucune donnée utilisateur dans le HTML (les tâches arrivent par `/api`). Les assets à hash sont mis en cache **volontairement** | Meii-Dicale | 19/11/2026 | 19/02/2027, ou si une page affiche des données privées |
| 10109 Modern Web Application | IGNORE | information : ZAP signale une SPA et conseille son spider AJAX ; ce n'est pas une faille | Meii-Dicale | 19/11/2026 | 19/02/2027 |
| 10020, 10021, 10036, 10037, 10038, 10063, 20020 | **FAIL** | en-têtes **corrigés** : leur disparition doit **bloquer la PR** (non-régression) | Meii-Dicale | 19/11/2026 | - |

Les autres règles gardent le comportement par défaut (WARN, non bloquant grâce à `-I`).

### gitleaks

Aucune exception, donc pas de `.gitleaks.toml` : l'historique complet passe sans fuite, y compris l'URL de base
jetable du dev (`postgres://taskflow:taskflow@…`).

### Semgrep

Aucune exception. Pour un faux positif : `// nosemgrep: <id-de-règle>` **sur la ligne** (jamais un `nosemgrep` nu), et
une ligne datée dans ce registre.

## 6. Limites connues

- La **baseline ZAP est passive** : ni injection (scan actif), ni authentification, ni contrôle d'accès. Elle
  n'explore pas non plus l'API JSON (`/api/*`). Elle ne remplace ni un scan actif sur le staging, ni la revue de code.
- **Semgrep** (règles publiques) rate une injection construite dans une autre fonction que l'appel : le SAST complète
  la revue, il ne la remplace pas.
- **npm audit** ne connaît que les CVE **publiées**, et rien sur les images de base (Trivy, dans `release.yml`).
- **Pas de HSTS** : le proxy de prod utilise un certificat auto-signé pour `taskflow.localhost` (lab). Avec un vrai
  domaine et un certificat reconnu, ajouter `Strict-Transport-Security` sur le proxy HTTPS.
- TaskFlow n'a **ni authentification ni comptes** : OWASP A01 (contrôle d'accès) et A07 (authentification) ne
  s'appliquent pas encore à ce code.
- Node.js 20 en fin de vie : [#25](https://github.com/Meii-Dicale/exo-devops/issues/25).

## 7. En cas de secret exposé

1. **Révoquer** le secret tout de suite (nouveau jeton, nouveau mot de passe : `ALTER USER` pour PostgreSQL).
2. Le remplacer dans `.env` (hors Git, droits 600) ou dans les secrets GitHub, puis redémarrer **seulement** le
   service concerné (`--no-deps`).
3. Vérifier que l'ancienne valeur est refusée et que le service fonctionne (`/health`, une action utilisateur).
4. S'il était dans Git : purger l'historique (`git filter-repo`), en sachant que les clones existants le gardent :
   la révocation reste l'étape qui compte.
5. Tracer l'événement (post-mortem ou issue), sans blâme.

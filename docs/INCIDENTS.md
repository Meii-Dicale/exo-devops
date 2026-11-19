# Incidents de production

Un post-mortem par incident, du plus récent au plus ancien. Il est **sans blâme** : on décrit des systèmes et des
processus, pas des personnes. Chaque post-mortem se termine par au moins une **issue** d'amélioration.

Que faire pendant l'incident : [monitoring/RUNBOOK.md](../monitoring/RUNBOOK.md) (une section par alerte).

## Modèle de post-mortem

Repris tel quel de la solution de la formation (`solution/docs/INCIDENTS.md`).

```markdown
## Incident n° N - Titre court

**Gravité** : faible / moyenne / élevée
**Détection** : alerte <nom> / utilisateur / autre - délai entre le début et la détection : X min
**Durée** : début hh:mm - fin hh:mm (durée totale = temps de rétablissement)
**Rédaction** : ...

### Résumé
Deux ou trois phrases : ce qui s'est passé et l'impact pour les utilisateurs.

### Chronologie (heure, UTC ou locale : préciser)
- hh:mm - Changement à l'origine de l'incident
- hh:mm - Premier signal (alerte, message d'un utilisateur...)
- hh:mm - Diagnostic : ce qu'on a regardé, ce qu'on a trouvé
- hh:mm - Correction appliquée
- hh:mm - Retour à la normale confirmé (sonde verte, [RESOLVED])

### Cause racine (5 pourquoi)
1. Pourquoi ... ?
...

### Ce qui a bien fonctionné
### Ce qui a moins bien fonctionné

### Actions
| Action | Type | Issue | Statut |
| --- | --- | --- | --- |
| ... | prévention / détection / processus | #N | à faire |
```

---

## Incident n° 1 - API indisponible : DATABASE_URL absente du .env de production

**Date** : 19/11/2026
**Gravité** : élevée (API entièrement indisponible, aucune perte de données)
**Détection** : alerte `TaskFlowApiDown` (mail Mailpit) - délai entre le début et la détection : **1 min 24 s**
**Durée** : début 10:32:06 - fin 10:35:06 UTC, soit **3 min 00 s** de rétablissement (3 min 24 s jusqu'au mail `[RESOLVED]`)
**Rédaction** : Meii-Dicale

### Résumé

Après une modification manuelle du `.env` de production, l'API a été recréée sans variable `DATABASE_URL`. Elle s'est
rabattue sur l'adresse par défaut du développement (`localhost:5432`), n'a pas pu joindre PostgreSQL et a redémarré en
boucle. Pendant 3 minutes, la page d'accueil s'affichait encore, mais tous les appels à l'API renvoyaient **502** :
impossible de lister, créer ou cocher une tâche. Aucune donnée n'a été perdue.

### Chronologie (UTC ; heure de Paris = UTC + 1)

- **10:32:06** - Le conteneur `api` est recréé avec un `.env` dont la clé `DATABASE_URL` est renommée `DATABASE_UR`
  (valeur inchangée). Premier log `fatal` à 10:32:06.951 : `Démarrage impossible : ECONNREFUSED`. **Début de l'incident.**
- **10:32:00-10:32:15** - Première sonde blackbox en échec : `probe_http_status_code = 502` sur `http://front/health`.
- **10:32:20** - `TaskFlowApiDown` passe en *pending* dans Prometheus (`activeAt`). `TaskFlowMetricsDown`
  (`up{job="taskflow-api"} = 0`) est **inhibée** par Alertmanager : une seule alerte arrive, la critique.
- **10:33:30** - **Premier signal** : mail `[FIRING:1] TaskFlowApiDown` dans Mailpit (critical, env `prod`).
  Délai de détection : 1 min 24 s (sonde toutes les 15 s, `for: 1m`, `group_wait: 10s`).
- **10:33:30-10:34:45** - Diagnostic, en suivant le runbook :
  - Prometheus : `probe_http_status_code` = 502 et `up{job="taskflow-api"}` = 0 : le front répond, l'API non.
  - Dashboard, panneau « Version » : `c6e3a19`, la même depuis le déploiement précédent. **Pas de nouvelle
    version** : un rollback d'image ne servirait à rien, la cause est ailleurs (configuration).
  - Dashboard, panneau « Erreurs 5xx » : presque vide. Normal : l'API est arrêtée et ne compte plus rien, et les 502
    sont produits par Nginx, qui n'est pas instrumenté.
  - `docker compose -f compose.prod.yaml ps` : `api` en `Restarting`, `RestartCount` 11, code de sortie 1.
  - Logs filtrés avec `jq` : `{"level":"fatal","message":"Démarrage impossible : ECONNREFUSED","hint":"Vérifiez DATABASE_URL..."}`.
  - Preuve : `.env` comparé à `.env.bak` (sauvegarde présente sur le serveur) : **une seule différence**, la clé
    `DATABASE_UR` au lieu de `DATABASE_URL`. `src/config.js` retombe alors sur `postgres://…@localhost:5432/taskflow`,
    d'où `ECONNREFUSED`.
- **10:34:49** - Correction : clé renommée en `DATABASE_URL` dans `~/taskflow-prod/.env` (droits 600 conservés), puis
  `IMAGE_TAG=c6e3a19 docker compose -f compose.prod.yaml up -d --wait api`.
- **10:35:06** - `api` *healthy*. **Fin de l'incident (rétablissement).**
- **10:35:15** - `/health` renvoie `ok` (version `c6e3a19`), une tâche est créée (id 4), la tâche existante est
  intacte, `probe_success` repasse à 1.
- **10:35:30** - Mail `[RESOLVED] TaskFlowApiDown` dans Mailpit.

**Impact mesuré** (logs Nginx) : 13 réponses 502 sur `/health` côté front (12 venant de la sonde blackbox) et 1 réponse
502 côté proxy. La page d'accueil (statique) est restée en 200.

**Mesures** :

| Indicateur | Calcul | Valeur |
| --- | --- | --- |
| Temps de détection | 10:32:06 → 10:33:30 | **1 min 24 s** |
| Temps de rétablissement (MTTR) | 10:32:06 → 10:35:06 | **3 min 00 s** |
| De l'alerte à la correction | 10:33:30 → 10:35:06 | 1 min 36 s |
| Jusqu'au `[RESOLVED]` | 10:32:06 → 10:35:30 | 3 min 24 s |

### Comment l'alerte et le dashboard ont aidé

- L'**alerte boîte noire** a prévenu sans qu'aucun utilisateur ait à le signaler, et son lien `runbook_url` menait
  directement à la bonne section de `monitoring/RUNBOOK.md`.
- L'**inhibition** a évité un deuxième mail (`TaskFlowMetricsDown`) pour la même panne.
- `probe_http_status_code = 502` + `up = 0` ont localisé la panne **entre le front et l'API** (une base en panne aurait
  donné un 503 avec `"db":"down"`).
- Le panneau **« Version »** a écarté en quelques secondes la piste du déploiement, donc du rollback.

### Cause racine (5 pourquoi)

1. **Pourquoi les utilisateurs recevaient-ils des 502 ?** Parce que Nginx ne trouvait plus d'API pour répondre : le
   conteneur `api` redémarrait en boucle.
2. **Pourquoi redémarrait-il en boucle ?** Parce qu'au démarrage, la connexion à PostgreSQL échouait
   (`ECONNREFUSED`) : l'API s'arrête alors avec le code 1 et la politique `restart: unless-stopped` la relance.
3. **Pourquoi la connexion échouait-elle ?** Parce que l'API essayait `localhost:5432`, c'est-à-dire son propre
   conteneur, où il n'y a pas de PostgreSQL.
4. **Pourquoi `localhost` ?** Parce que `DATABASE_URL` était absente de l'environnement du conteneur (clé renommée
   `DATABASE_UR` dans le `.env`) et que `readConfig()` retombe **silencieusement** sur la valeur par défaut du
   développement, quel que soit l'environnement.
5. **Pourquoi une clé manquante a-t-elle pu atteindre la production ?** Parce que le `.env` de production se modifie à
   la main, hors de Git et du pipeline, et que **rien ne le valide** : ni `deploy.sh` (aucune comparaison avec
   `.env.example`), ni l'API (aucune variable obligatoire en production). `env_file` transmet tout, sans contrôle.

**Cause racine** : la configuration de production n'est validée nulle part, et l'API accepte en production une valeur
par défaut prévue pour le poste de développement.

### Ce qui a bien fonctionné

- La sonde blackbox à travers le front a détecté la panne vue par l'utilisateur en moins d'1 min 30.
- Une seule notification, critique, grâce à l'inhibition ; puis le `[RESOLVED]` pour confirmer la fin.
- Le log `fatal` est structuré et contient un indice (`hint`) qui nomme `DATABASE_URL`.
- Le panneau « Version » a évité un rollback inutile.
- La sauvegarde `.env.bak` a permis de **prouver** la cause par comparaison, au lieu de la deviner.
- Les données étaient sur un volume nommé : rien n'a été perdu.

### Ce qui a moins bien fonctionné

- L'API a démarré avec une configuration invalide au lieu de refuser de démarrer avec un message clair : le message
  `ECONNREFUSED` oriente d'abord vers la base, pas vers la configuration.
- Le panneau « Erreurs 5xx » reste presque vide quand l'API est morte : sans la sonde, le dashboard aurait pu laisser
  croire que « tout va bien ».
- Le `.env` n'a pas d'historique : impossible de savoir quand il a changé (la correction a écrasé la date de
  modification). Sans le `.env.bak`, la comparaison n'aurait pas été possible.
- Le `.env.bak` est une copie des secrets de production laissée sur le serveur : il a été utile au diagnostic, mais
  doit être supprimé.
- La commande de correction (`up -d api`) a aussi **recréé le conteneur `db`** (10:34:49), alors que sa configuration
  n'avait pas changé (même `com.docker.compose.config-hash`). Les données sont intactes (volume), mais la raison de
  cette recréation n'est pas établie ; `--no-deps` l'aurait évitée.

### Actions

| Action | Type | Issue | Statut |
| --- | --- | --- | --- |
| L'API refuse de démarrer si `DATABASE_URL` est absente ou vide hors `APP_ENV=local` ; test dans `api/tests/config.test.js` | prévention | [#21](https://github.com/Meii-Dicale/exo-devops/issues/21) | fait ([#23](https://github.com/Meii-Dicale/exo-devops/pull/23)) |
| `deploy.sh` compare les clés de `.env` à celles de `.env.example` et s'arrête s'il en manque une | prévention | à créer | à faire |
| Dashboard : panneau « Code HTTP de la sonde » (`probe_http_status_code`), pour voir les 502 que l'API ne compte pas | détection | à créer | à faire |
| Runbook : recréer l'API avec `--no-deps`, et supprimer `.env.bak` une fois l'incident clos | processus | à créer | à faire |
| Supprimer `~/taskflow-prod/.env.bak` (secrets de production en double sur le serveur) | processus | - | à faire |

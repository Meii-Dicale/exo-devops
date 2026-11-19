# Runbook des alertes TaskFlow

Que faire quand une alerte arrive. Les commandes se lancent dans `~/taskflow-prod`, sauf mention contraire.

Liens : [Grafana](http://localhost:3001) · [Prometheus > Alerts](http://localhost:9090/alerts) · [Alertmanager](http://localhost:9093) · [Mailpit](http://localhost:8025)

## TaskFlowApiDown

**Signification** : `GET http://front/health` (front → Nginx → API → base) ne renvoie pas 200 avec `"status":"ok"` depuis 1 minute. Les utilisateurs sont touchés.

1. Voir le symptôme : `curl -sk https://taskflow.localhost/health`.
   - 502 : le front ne joint pas l'API.
   - 503 avec `"db":"down"` : l'API ne joint pas la base.
2. Dashboard, panneau « Code HTTP de la sonde /health » : le code renvoyé et depuis quand (un 502 du front n'apparaît **pas** dans les panneaux RED, l'API ne le voit jamais). Prometheus, *Graph* : `up{job="taskflow-api"}` pour savoir si l'API répond encore.
3. Vérifier l'état des conteneurs : `docker compose -f compose.prod.yaml ps` (redémarrage en boucle ? *unhealthy* ?).
4. Lire les logs sans le bruit : `docker compose -f compose.prod.yaml logs --no-log-prefix --since 15m api | jq -c 'select(.level != "info")'`.
5. Dashboard, panneau « Version » : un déploiement juste avant ? Si oui, rollback (`release.yml`, *Run workflow*, tag précédent). Sinon, chercher un changement de configuration (`.env`, compose) : un rollback d'image ne le corrigera pas.
6. Corriger un `.env` à chaud (incident n° 1, `docs/INCIDENTS.md`) :
   - copie de sauvegarde **hors du dossier** et lisible par toi seul : `install -m 600 .env /tmp/env.avant-correction` ;
   - après la correction, comparer les **noms** des clés, jamais les valeurs : `diff <(grep -oE '^[A-Z_][A-Z0-9_]*=' .env.example | sort) <(grep -oE '^[A-Z_][A-Z0-9_]*=' .env | sort)` ;
   - recréer **la seule API** : `docker compose -f compose.prod.yaml up -d --no-deps --wait api`. Sans `--no-deps`, Compose peut recréer aussi `db` (vu pendant l'incident n° 1) ;
   - le prochain `./deploy.sh` refuse de toute façon un `.env` auquel il manque une clé de `.env.example`.
7. Après la correction : `ps` (*healthy*), `/health`, création d'une tâche, mail `[RESOLVED]`. **Supprimer la copie** du `.env` (`rm /tmp/env.avant-correction`) : ce sont des secrets de production en double. Puis rédiger le post-mortem dans `docs/INCIDENTS.md`.

## TaskFlowMetricsDown

**Signification** : Prometheus ne lit plus `api:3000/metrics`. Si l'application répond encore, on est seulement **aveugle** : sans métriques RED, une panne réelle ne serait plus vue que par la sonde.

1. Prometheus, *Status > Targets* : lire l'erreur (`no such host` : Prometheus n'est plus sur le réseau `taskflow-prod` ; `connection refused` : l'API redémarre).
2. Depuis la prod : `docker compose -f compose.prod.yaml exec api wget -qO- http://127.0.0.1:3000/metrics | head`.
3. Après une recréation du réseau de prod : `docker compose -f compose.monitoring.yaml up -d --force-recreate prometheus blackbox` (dans `monitoring/`).

## TaskFlowHighErrorRate

**Signification** : plus de 5 % des requêtes finissent en 5xx depuis 5 minutes.

1. Dashboard, panneau « Erreurs par code » : quelles routes, depuis quand, une nouvelle version ?
2. Logs : `... logs --no-log-prefix --since 15m api | jq -c 'select(.status >= 500 or .level == "error")'`.
3. Si l'erreur a commencé avec une nouvelle version : rollback. Sinon, chercher du côté de la base (`db` *healthy* ? disque plein ?).

## TaskFlowHighLatency

**Signification** : le p95 dépasse 300 ms depuis 5 minutes.

1. Dashboard : latence p50, p95 et p99 par route, et lag de l'event loop Node (`nodejs_eventloop_lag_p99_seconds`).
2. Les requêtes les plus lentes : `... logs --no-log-prefix --since 15m api | jq -s '[.[] | select(.ms)] | sort_by(.ms) | reverse | .[0:5]'`.
3. Ressources : `docker stats --no-stream` (CPU ou mémoire saturés ? base lente ?).

## Supervision : fichiers de configuration absents des conteneurs

**Symptôme** : un rechargement échoue (`cat: can't open '/etc/blackbox/blackbox.yml'`), Grafana ne prend pas un dashboard modifié, alors que les fichiers sont bien dans le dépôt.

**Cause** : les conteneurs montent `monitoring/` depuis le clone. Passer sur une branche qui n'a pas ce dossier (ex. une vieille branche de l'étape 1) le **supprime**, puis le recrée au retour : les conteneurs restent accrochés à l'ancien dossier, vide. Ils tournent encore avec la configuration chargée au démarrage, jusqu'au prochain rechargement.

1. Vérifier : `docker exec taskflow-monitoring-prometheus-1 ls /etc/prometheus` (vide = montage perdu).
2. Redémarrer pour remonter les dossiers actuels : `docker restart taskflow-monitoring-blackbox-1 taskflow-monitoring-alertmanager-1 taskflow-monitoring-prometheus-1 taskflow-monitoring-grafana-1`.
3. Contrôler : *Status > Targets* tout `up`, règles chargées, `Watchdog` de retour dans Alertmanager.

## Watchdog

Toujours active, jamais notifiée (route `nulle-part` dans `alertmanager.yml`). Si elle **disparaît** d'Alertmanager, la chaîne d'alerte est cassée (Prometheus arrêté, ou Alertmanager qu'il ne joint plus) : plus aucune alerte n'arriverait.

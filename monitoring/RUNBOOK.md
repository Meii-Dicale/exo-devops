# Runbook des alertes TaskFlow

Que faire quand une alerte arrive. Les commandes se lancent dans `~/taskflow-prod`, sauf mention contraire.

Liens : [Grafana](http://localhost:3001) · [Prometheus > Alerts](http://localhost:9090/alerts) · [Alertmanager](http://localhost:9093) · [Mailpit](http://localhost:8025)

## TaskFlowApiDown

**Signification** : `GET http://front/health` (front → Nginx → API → base) ne renvoie pas 200 avec `"status":"ok"` depuis 1 minute. Les utilisateurs sont touchés.

1. Voir le symptôme : `curl -sk https://taskflow.localhost/health`.
   - 502 : le front ne joint pas l'API.
   - 503 avec `"db":"down"` : l'API ne joint pas la base.
2. Prometheus, *Graph* : `probe_http_status_code{job="blackbox-health"}` pour le code renvoyé, `up{job="taskflow-api"}` pour savoir si l'API répond encore.
3. Vérifier l'état des conteneurs : `docker compose -f compose.prod.yaml ps` (redémarrage en boucle ? *unhealthy* ?).
4. Lire les logs sans le bruit : `docker compose -f compose.prod.yaml logs --no-log-prefix --since 15m api | jq -c 'select(.level != "info")'`.
5. Dashboard, panneau « Version » : un déploiement juste avant ? Si oui, rollback (`release.yml`, *Run workflow*, tag précédent). Sinon, chercher un changement de configuration (`.env`, compose) : un rollback d'image ne le corrigera pas.
6. Après la correction : `ps` (*healthy*), `/health`, création d'une tâche, mail `[RESOLVED]`. Puis rédiger le post-mortem dans `docs/INCIDENTS.md`.

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

## Watchdog

Toujours active, jamais notifiée (route `nulle-part` dans `alertmanager.yml`). Si elle **disparaît** d'Alertmanager, la chaîne d'alerte est cassée (Prometheus arrêté, ou Alertmanager qu'il ne joint plus) : plus aucune alerte n'arriverait.

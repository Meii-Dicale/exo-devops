// Métriques Prometheus de l'API (méthode RED : Rate, Errors, Duration),
// plus une métrique métier et la version déployée.
//
// Chaque appel crée SON registre (pas le registre global de prom-client) :
// chaque test construit une application neuve sans conflit de noms.
import client from 'prom-client';

// Seuils de l'histogramme, en secondes : de 5 ms à 5 s.
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

// Label `route` : la route Express (« /api/tasks/:id/toggle »), JAMAIS l'URL réelle
// (« /api/tasks/42/toggle »), sinon une série par identifiant (cardinalité infinie).
// À appeler quand la réponse est terminée : req.route n'existe qu'après le routage.
function routeLabel(req, res) {
  if (res.locals.metricsRoute) return res.locals.metricsRoute;
  if (!req.route) return 'unmatched';
  const route = `${req.baseUrl}${req.route.path}`;
  // Le routeur des tâches déclare « / » : « /api/tasks/ » devient « /api/tasks ».
  return route.length > 1 ? route.replace(/\/$/, '') : route;
}

export function createMetrics({
  appVersion = 'dev',
  collectDefaults = true,
} = {}) {
  const register = new client.Registry();

  if (collectDefaults) {
    // CPU, mémoire, event loop, GC… du processus Node.
    client.collectDefaultMetrics({ register });
  }

  const labelNames = ['method', 'route', 'status_code'];

  const requestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Nombre de requêtes HTTP traitées',
    labelNames,
    registers: [register],
  });

  const requestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Durée de traitement des requêtes HTTP, en secondes',
    labelNames,
    buckets: DURATION_BUCKETS,
    registers: [register],
  });

  const tasksCreated = new client.Counter({
    name: 'taskflow_tasks_created_total',
    help: 'Nombre de tâches créées',
    registers: [register],
  });

  const buildInfo = new client.Gauge({
    name: 'taskflow_build_info',
    help: "Version de l'API en cours d'exécution (valeur toujours à 1)",
    labelNames: ['version'],
    registers: [register],
  });
  buildInfo.set({ version: appVersion }, 1);

  function middleware(req, res, next) {
    const stopTimer = requestDuration.startTimer();

    res.on('finish', () => {
      const labels = {
        method: req.method,
        route: routeLabel(req, res),
        status_code: String(res.statusCode),
      };
      requestsTotal.inc(labels);
      stopTimer(labels);
    });

    next();
  }

  // Middleware d'erreur à monter À LA FIN d'un routeur. Quand une erreur sort du
  // routeur, Express remet req.baseUrl à vide : sans lui, une 500 sur « /api/tasks »
  // serait comptée sous « / ». On note donc la route complète tant qu'on la connaît.
  function keepRouteOnError(err, req, res, next) {
    res.locals.metricsRoute = routeLabel(req, res);
    next(err);
  }

  async function handler(_req, res) {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  }

  return {
    register,
    middleware,
    handler,
    keepRouteOnError,
    taskCreated: () => tasksCreated.inc(),
  };
}

// Lecture de la configuration depuis les variables d'environnement.
// Une seule fonction, pure : on lui donne un objet env, elle renvoie la config.
// Elle lève une erreur si la configuration est invalide : server.js la logge en
// "fatal" et l'API s'arrête avec un message qui nomme la variable en cause.

const DEFAULT_PORT = 3000;
// Valeur par défaut réservée au poste de développement (APP_ENV=local).
const DEFAULT_DATABASE_URL =
  'postgres://taskflow:taskflow@localhost:5432/taskflow';

export function readConfig(env = process.env) {
  const appEnv = env.APP_ENV || 'local';

  // Hors local, localhost désigne le conteneur de l'API lui-même : retomber
  // dessus donne un ECONNREFUSED trompeur (incident n° 1, docs/INCIDENTS.md).
  if (appEnv !== 'local' && !env.DATABASE_URL) {
    throw new Error(
      `DATABASE_URL manquante ou vide (APP_ENV=${appEnv}) : vérifiez le .env, la valeur par défaut localhost ne sert qu'en local`,
    );
  }

  return Object.freeze({
    port: Number(env.PORT) || DEFAULT_PORT,
    databaseUrl: env.DATABASE_URL || DEFAULT_DATABASE_URL,
    appEnv,
    appVersion: env.APP_VERSION || 'dev',
  });
}

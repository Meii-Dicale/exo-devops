import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

describe('readConfig', () => {
  it("utilise les valeurs par défaut quand aucune variable n'est définie", () => {
    expect(readConfig({})).toEqual({
      port: 3000,
      databaseUrl: 'postgres://taskflow:taskflow@localhost:5432/taskflow',
      appEnv: 'local',
      appVersion: 'dev',
    });
  });

  it("lit les variables d'environnement fournies", () => {
    const config = readConfig({
      PORT: '4000',
      DATABASE_URL: 'postgres://u:p@db:5432/x',
      APP_ENV: 'production',
      APP_VERSION: 'abc1234',
    });

    expect(config).toEqual({
      port: 4000,
      databaseUrl: 'postgres://u:p@db:5432/x',
      appEnv: 'production',
      appVersion: 'abc1234',
    });
  });

  // Incident n° 1 (docs/INCIDENTS.md) : clé renommée DATABASE_UR dans le .env de
  // prod, l'API retombait sur localhost et redémarrait en boucle (ECONNREFUSED).
  describe('DATABASE_URL obligatoire hors local', () => {
    it.each(['production', 'staging'])(
      'refuse de démarrer sans DATABASE_URL quand APP_ENV=%s',
      (appEnv) => {
        expect(() => readConfig({ APP_ENV: appEnv })).toThrow(/DATABASE_URL/);
      },
    );

    it('refuse une DATABASE_URL vide en production', () => {
      expect(() =>
        readConfig({ APP_ENV: 'production', DATABASE_URL: '' }),
      ).toThrow(/DATABASE_URL/);
    });

    it("refuse la clé mal nommée de l'incident (DATABASE_UR)", () => {
      expect(() =>
        readConfig({
          APP_ENV: 'production',
          DATABASE_UR: 'postgres://u:p@db:5432/x',
        }),
      ).toThrow(/DATABASE_URL/);
    });

    it('garde la valeur par défaut en local, explicite ou implicite', () => {
      expect(readConfig({ APP_ENV: 'local' }).databaseUrl).toBe(
        'postgres://taskflow:taskflow@localhost:5432/taskflow',
      );
      expect(readConfig({}).databaseUrl).toBe(
        'postgres://taskflow:taskflow@localhost:5432/taskflow',
      );
    });
  });
});

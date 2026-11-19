// Tests de /metrics : format, labels `route` normalisés (cardinalité), erreurs comptées,
// et collectes de Prometheus invisibles dans les logs.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createMetrics } from '../src/metrics.js';
import { createMemoryRepository } from '../src/repositories/memory.js';

function buildApp(repository = createMemoryRepository()) {
  const log = vi.fn();
  const metrics = createMetrics({
    appVersion: '1.2.3',
    collectDefaults: false,
  });
  const app = createApp({
    repository,
    appEnv: 'test',
    appVersion: '1.2.3',
    log,
    metrics,
  });
  return { app, log };
}

const getMetrics = async (app) => (await request(app).get('/metrics')).text;

describe('GET /metrics', () => {
  let app;
  let log;

  beforeEach(() => {
    ({ app, log } = buildApp());
  });

  it('répond 200 au format texte de Prometheus', async () => {
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain/);
    expect(response.text).toContain('taskflow_build_info{version="1.2.3"} 1');
  });

  it('utilise la route Express comme label, jamais l’URL réelle', async () => {
    await request(app).post('/api/tasks').send({ title: 'Mesurer' });
    await request(app).patch('/api/tasks/1/toggle');

    const text = await getMetrics(app);

    expect(text).toContain('route="/api/tasks"');
    expect(text).toContain('route="/api/tasks/:id/toggle"');
    expect(text).not.toContain('/api/tasks/1');
    expect(text).not.toContain('route="/api/tasks/"');
  });

  it('compte une URL inconnue sous le label unmatched', async () => {
    await request(app).get('/api/nimporte-quoi/123');

    const text = await getMetrics(app);

    expect(text).toMatch(
      /http_requests_total\{[^}]*route="unmatched"[^}]*status_code="404"[^}]*\} 1/,
    );
    expect(text).not.toContain('nimporte-quoi');
  });

  it('compte les tâches créées (métrique métier), pas les refus', async () => {
    await request(app).post('/api/tasks').send({ title: 'Une' });
    await request(app).post('/api/tasks').send({ title: '' }); // 400 : pas de création

    expect(await getMetrics(app)).toContain('taskflow_tasks_created_total 1');
  });

  it("n'écrit pas de log et ne se compte pas lui-même", async () => {
    await request(app).get('/metrics');
    const text = await getMetrics(app);

    expect(log).not.toHaveBeenCalled();
    expect(text).not.toContain('route="/metrics"');
  });
});

describe('Erreurs serveur', () => {
  it('compte une réponse 500 quand le repository rejette', async () => {
    const repository = {
      ...createMemoryRepository(),
      list: () => Promise.reject(new Error('base injoignable')),
    };
    const { app } = buildApp(repository);

    const response = await request(app).get('/api/tasks');
    const text = await getMetrics(app);

    expect(response.status).toBe(500);
    expect(text).toMatch(
      /http_requests_total\{method="GET",route="\/api\/tasks",status_code="500"\} 1/,
    );
  });
});

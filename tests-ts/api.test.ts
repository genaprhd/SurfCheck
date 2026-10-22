import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('API authentication and CORS', () => {
  let server: Awaited<ReturnType<(typeof import('../apps/api/src/server.js'))['createServer']>>;

  beforeAll(async () => {
    vi.stubEnv('SURF_CHECK_WRITE_TOKEN', 'unit-test-secret');
    vi.stubEnv('CORS_ORIGINS', 'https://surf.example');
    const module = await import('../apps/api/src/server.js');
    server = module.createServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    vi.unstubAllEnvs();
  });

  it('accepts the configured admin token and rejects an invalid token', async () => {
    const accepted = await server.inject({
      method: 'POST',
      url: '/api/auth',
      headers: { authorization: 'Bearer unit-test-secret' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ authenticated: true });

    const rejected = await server.inject({
      method: 'POST',
      url: '/api/auth',
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(rejected.statusCode).toBe(401);
  });

  it('allows browser preflight for the configured frontend origin', async () => {
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/api/auth',
      headers: {
        origin: 'https://surf.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://surf.example');
  });

  it('validates archive methodology parameters before requesting external data', async () => {
    const invalidDate = await server.inject({
      method: 'GET',
      url: '/api/methodology?spotId=malinovka&date=2025-02-30&hour=7',
    });
    expect(invalidDate.statusCode).toBe(400);

    const unknownSpot = await server.inject({
      method: 'GET',
      url: '/api/methodology?spotId=missing-spot&date=2025-06-01&hour=7',
    });
    expect(unknownSpot.statusCode).toBe(404);
  });
});

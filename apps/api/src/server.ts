import { createHash, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { startRefresh, state } from './forecast.js';
import { getSpots, saveSpots } from './spots.js';

const AuthorizationSchema = z.string().startsWith('Bearer ');

function hasValidToken(authorization: string | undefined): boolean | null {
  if (!config.writeToken) return null;
  const parsed = AuthorizationSchema.safeParse(authorization ?? '');
  if (!parsed.success) return false;
  const supplied = createHash('sha256').update(parsed.data.slice(7).trim()).digest();
  const expected = createHash('sha256').update(config.writeToken).digest();
  return timingSafeEqual(supplied, expected);
}

export function createServer() {
  const app = Fastify({
    bodyLimit: 65_536,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization'],
    },
  });

  app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/api/state', async () => state);
  app.get('/api/spots', async () => ({ spots: getSpots() }));
  app.get('/api/refresh', async (_request, reply) => {
    startRefresh();
    return reply.send(state);
  });

  app.post('/api/auth', async (request, reply) => {
    const valid = hasValidToken(request.headers.authorization);
    if (valid === null) {
      return reply.code(503).send({ error: 'Запись отключена: на backend не настроен токен.' });
    }
    if (!valid) return reply.code(401).send({ error: 'Неверный токен доступа.' });
    return { authenticated: true };
  });

  app.post<{ Body: { spots?: unknown } }>('/api/spots', async (request, reply) => {
    const valid = hasValidToken(request.headers.authorization);
    if (valid === null) {
      return reply.code(503).send({ error: 'Запись отключена: на backend не настроен токен.' });
    }
    if (!valid) return reply.code(401).send({ error: 'Неверный токен доступа.' });

    const payloadSchema = z.object({ spots: z.unknown() });
    const payload = payloadSchema.safeParse(request.body);
    if (!payload.success) {
      return reply.code(400).send({ error: 'Ожидался объект со списком точек.' });
    }

    try {
      const spots = await saveSpots(payload.data.spots);
      startRefresh();
      return reply.send({ spots, loading: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply
          .code(400)
          .send({ error: error.issues[0]?.message ?? 'Некорректный список точек.' });
      }
      request.log.error({ err: error }, 'Failed to save spots');
      return reply.code(500).send({
        error: `Не удалось сохранить точки: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request failed');
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400
        ? error.statusCode
        : 500;
    return reply.code(statusCode).send({
      error:
        statusCode === 413 ? 'Размер запроса превышает 65536 байт.' : 'Внутренняя ошибка сервера.',
    });
  });
  return app;
}

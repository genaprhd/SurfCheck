import { resolve } from 'node:path';
import { z } from 'zod';

const EnvironmentSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8777),
  SURF_CHECK_SPOTS_FILE: z.string().optional(),
  SURF_CHECK_WRITE_TOKEN: z.string().default(''),
  DATABASE_URL: z.string().trim().min(1).optional(),
  CORS_ORIGINS: z.string().optional(),
});

const environment = EnvironmentSchema.parse(process.env);

export const config = {
  host: environment.HOST,
  port: environment.PORT,
  spotsFile: resolve(
    environment.SURF_CHECK_SPOTS_FILE ?? resolve(process.cwd(), 'surf_check_spots.json'),
  ),
  writeToken: environment.SURF_CHECK_WRITE_TOKEN,
  databaseUrl: environment.DATABASE_URL,
  corsOrigins: (environment.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  maxSpots: 40,
  forecastHours: 97,
  bestWindowHours: 49,
} as const;

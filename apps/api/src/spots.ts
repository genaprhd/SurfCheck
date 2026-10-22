import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { z } from 'zod';
import { DEFAULT_SPOTS, SpotsSchema, type Spot } from '@surf-check/shared';
import { config } from './config.js';

let spots = structuredClone(SpotsSchema.parse(DEFAULT_SPOTS));
let writeQueue: Promise<void> = Promise.resolve();
const database = config.databaseUrl ? neon(config.databaseUrl) : null;

export async function loadSavedSpots(): Promise<void> {
  if (database) {
    await loadDatabaseSpots();
    return;
  }

  spots = await readFileSpots();
}

async function loadDatabaseSpots(): Promise<void> {
  if (!database) {
    throw new Error('Подключение к базе данных не настроено.');
  }

  await database`
    CREATE TABLE IF NOT EXISTS surf_check_spots (
      id smallint PRIMARY KEY CHECK (id = 1),
      spots jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const rows = await database`SELECT spots FROM surf_check_spots WHERE id = 1`;
  if (rows.length) {
    spots = SpotsSchema.parse(z.object({ spots: z.unknown() }).parse(rows[0]).spots);
    return;
  }

  const initialSpots = await readFileSpots();
  await database`
    INSERT INTO surf_check_spots (id, spots)
    VALUES (1, ${JSON.stringify(initialSpots)}::jsonb)
    ON CONFLICT (id) DO NOTHING
  `;
  const seededRows = await database`SELECT spots FROM surf_check_spots WHERE id = 1`;
  if (!seededRows.length) {
    throw new Error('Не удалось создать начальную конфигурацию спотов в базе данных.');
  }
  spots = SpotsSchema.parse(z.object({ spots: z.unknown() }).parse(seededRows[0]).spots);
}

async function readFileSpots(): Promise<Spot[]> {
  try {
    const saved = JSON.parse(await readFile(config.spotsFile, 'utf8')) as unknown;
    return SpotsSchema.parse(saved);
  } catch (error) {
    if (isMissingFile(error)) return structuredClone(SpotsSchema.parse(DEFAULT_SPOTS));
    throw new Error(`Не удалось загрузить ${config.spotsFile}: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

export function getSpots(): Spot[] {
  return structuredClone(spots);
}

export async function saveSpots(input: unknown): Promise<Spot[]> {
  const normalized = SpotsSchema.parse(input);
  const persist = async (): Promise<void> => {
    if (database) {
      await database`
        INSERT INTO surf_check_spots (id, spots, updated_at)
        VALUES (1, ${JSON.stringify(normalized)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE
        SET spots = EXCLUDED.spots, updated_at = now()
      `;
    } else {
      await saveFileSpots(normalized);
    }
    spots = normalized;
  };

  const result = writeQueue.then(persist);
  writeQueue = result.catch(() => undefined);
  await result;
  return getSpots();
}

async function saveFileSpots(normalized: Spot[]): Promise<void> {
  const temporaryFile = `${config.spotsFile}.${randomUUID()}.tmp`;
  await mkdir(dirname(config.spotsFile), { recursive: true });
  try {
    await writeFile(temporaryFile, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryFile, config.spotsFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => undefined);
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

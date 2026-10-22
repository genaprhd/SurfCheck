import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_SPOTS, SpotsSchema, type Spot } from '@surf-check/shared';
import { config } from './config.js';

let spots = structuredClone(SpotsSchema.parse(DEFAULT_SPOTS));
let writeQueue: Promise<void> = Promise.resolve();

export async function loadSavedSpots(): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(config.spotsFile, 'utf8')) as unknown;
    spots = SpotsSchema.parse(saved);
  } catch (error) {
    if (isMissingFile(error)) return;
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
  const temporaryFile = `${config.spotsFile}.${randomUUID()}.tmp`;
  const persist = async (): Promise<void> => {
    await mkdir(dirname(config.spotsFile), { recursive: true });
    try {
      await writeFile(temporaryFile, `${JSON.stringify(normalized, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(temporaryFile, config.spotsFile);
      spots = normalized;
    } catch (error) {
      await unlink(temporaryFile).catch(() => undefined);
      throw error;
    }
  };

  const result = writeQueue.then(persist);
  writeQueue = result.catch(() => undefined);
  await result;
  return getSpots();
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

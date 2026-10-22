import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SPOTS } from '@surf-check/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMock = vi.hoisted(() => {
  let storedSpots: unknown;

  const query = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const statement = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (statement.startsWith('SELECT')) {
      return storedSpots === undefined ? [] : [{ spots: storedSpots }];
    }
    if (statement.startsWith('INSERT')) {
      const nextSpots = JSON.parse(String(values[0])) as unknown;
      storedSpots = statement.includes('DO NOTHING') ? (storedSpots ?? nextSpots) : nextSpots;
    }
    return [];
  };

  return {
    query,
    getSpots: () => storedSpots,
    reset: () => {
      storedSpots = undefined;
    },
  };
});

describe('spot persistence', () => {
  let directory: string;
  let spotsFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'surf-check-spots-'));
    spotsFile = join(directory, 'spots.json');
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('SURF_CHECK_SPOTS_FILE', spotsFile);
    vi.resetModules();
    databaseMock.reset();
  });

  afterEach(async () => {
    vi.doUnmock('@neondatabase/serverless');
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('uses and updates the local JSON file when DATABASE_URL is not set', async () => {
    const { getSpots, loadSavedSpots, saveSpots } = await import('../apps/api/src/spots.js');

    await loadSavedSpots();
    expect(getSpots()).toEqual(DEFAULT_SPOTS);

    await saveSpots(DEFAULT_SPOTS);
    expect(JSON.parse(await readFile(spotsFile, 'utf8'))).toEqual(DEFAULT_SPOTS);
  });

  it('seeds Neon from defaults and persists subsequent spot updates', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:password@db.example.test/surf?sslmode=require');
    vi.doMock('@neondatabase/serverless', () => ({
      neon: () => databaseMock.query,
    }));
    vi.resetModules();
    const { getSpots, loadSavedSpots, saveSpots } = await import('../apps/api/src/spots.js');

    await loadSavedSpots();
    expect(getSpots()).toEqual(DEFAULT_SPOTS);

    await saveSpots(DEFAULT_SPOTS);
    expect(databaseMock.getSpots()).toEqual(DEFAULT_SPOTS);
    expect(getSpots()).toEqual(DEFAULT_SPOTS);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SPOTS, SpotsSchema } from '@surf-check/shared';

describe('spot configuration', () => {
  it('accepts the default surf spots', () => {
    const spots = SpotsSchema.parse(DEFAULT_SPOTS);
    expect(spots).toHaveLength(6);
    expect(spots[0]?.rideBearing).toBe(180);
  });

  it('migrates saved shore-facing bearings to surfer ride directions', () => {
    const migrated = SpotsSchema.parse([
      {
        id: 'legacy_spot',
        name: 'Старый спот',
        note: '',
        lat: 54.9,
        lon: 20.2,
        bestFrom: [300, 340, 20],
        shoreBearing: 336,
      },
    ]);
    expect(migrated[0]?.rideBearing).toBe(156);
    expect(migrated[0]).not.toHaveProperty('shoreBearing');
  });

  it('migrates legacy offshore directions and accepts new ride bearings unchanged', () => {
    const migrated = SpotsSchema.parse([
      {
        id: 'legacy_offshore_spot',
        name: 'Старый спот',
        note: '',
        lat: 54.9,
        lon: 20.2,
        bestFrom: [300, 340, 20],
        offshore: [135, 180, 225],
      },
      {
        id: 'new_spot',
        name: 'Новый спот',
        note: '',
        lat: 54.9,
        lon: 20.2,
        bestFrom: [300, 340, 20],
        rideBearing: 336,
      },
    ]);
    expect(migrated[0]?.rideBearing).toBe(180);
    expect(migrated[1]?.rideBearing).toBe(336);
    expect(migrated[0]).not.toHaveProperty('offshore');
  });

  it('rejects duplicate IDs and invalid coordinates', () => {
    const duplicate = DEFAULT_SPOTS.map((spot) => ({ ...spot }));
    duplicate[1]!.id = duplicate[0]!.id;
    expect(SpotsSchema.safeParse(duplicate).success).toBe(false);

    const invalidCoordinates = DEFAULT_SPOTS.map((spot) => ({ ...spot }));
    invalidCoordinates[0]!.lat = 91;
    expect(SpotsSchema.safeParse(invalidCoordinates).success).toBe(false);
  });
});

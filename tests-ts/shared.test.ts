import { describe, expect, it } from 'vitest';
import { DEFAULT_SPOTS, SpotsSchema } from '@surf-check/shared';

describe('spot configuration', () => {
  it('accepts the default surf spots', () => {
    expect(SpotsSchema.parse(DEFAULT_SPOTS)).toHaveLength(6);
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

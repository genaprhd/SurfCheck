import { describe, expect, it } from 'vitest';
import { DEFAULT_SPOTS } from '@surf-check/shared';
import { evaluateHour, interpolate } from '../apps/api/src/scoring.js';

describe('forecast scoring', () => {
  it('clamps interpolation to the curve bounds', () => {
    expect(
      interpolate(-1, [
        [0, 10],
        [1, 20],
      ]),
    ).toBe(10);
    expect(
      interpolate(2, [
        [0, 10],
        [1, 20],
      ]),
    ).toBe(20);
  });

  it('evaluates a forecast hour in the response shape used by the UI', () => {
    const marine = {
      wave_height: [0.6],
      wave_period: [6],
      wave_direction: [300],
      swell_wave_height: [0.5],
      swell_wave_period: [6],
      swell_wave_direction: [300],
      wind_wave_height: [0.3],
      wind_wave_period: [4],
      wind_wave_direction: [300],
      sea_surface_temperature: [12],
    };
    const weather = {
      wind_speed_10m: [3],
      wind_gusts_10m: [4],
      wind_direction_10m: [180],
      precipitation_probability: [0],
      weather_code: [0],
    };

    const result = evaluateHour(DEFAULT_SPOTS[0]!, marine, weather, 0, 0, 1_700_000_000);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.waveDirDeg).toBe(300);
    expect(result.gear).toBe('4/3 мм');
    expect(result).toHaveProperty('danger');
  });

  it('caps the score and flags thunderstorms as dangerous', () => {
    const result = evaluateHour(
      DEFAULT_SPOTS[0]!,
      { wave_height: [1], wave_period: [7], wave_direction: [300] },
      { wind_speed_10m: [2], wind_gusts_10m: [3], wind_direction_10m: [180], weather_code: [95] },
      0,
      0,
      1_700_000_000,
    );
    expect(result.danger).toBe(true);
    expect(result.score).toBeLessThanOrEqual(12);
    expect(result.verdict).toBe('Опасно');
  });
});

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
    const weightedScore =
      result.scoreBreakdown.waveHeight * 0.4 +
      result.scoreBreakdown.period * 0.22 +
      result.scoreBreakdown.waveDirection * 0.2 +
      result.scoreBreakdown.wind * 0.18;
    expect(result.score).toBe(Math.round(weightedScore));
    expect(result.scoreBreakdown.limit).toBeNull();
    expect(result.waveDirDeg).toBe(300);
    expect(result.windType).toBe('offshore');
    expect(result.windDirDeg).toBe(180);
    expect(result.board).toBe('longboard');
    expect(result.sst).toBe(12);
    expect(result).toHaveProperty('danger');
  });

  it('classifies wind against the surfer heading, including compass wraparound', () => {
    const evaluateWind = (spot: (typeof DEFAULT_SPOTS)[number], direction: number) =>
      evaluateHour(
        spot,
        { wave_height: [1], wave_period: [7], wave_direction: [300] },
        {
          wind_speed_10m: [3],
          wind_gusts_10m: [4],
          wind_direction_10m: [direction],
        },
        0,
        0,
        1_700_000_000,
      ).windType;

    for (const spot of DEFAULT_SPOTS) {
      expect(evaluateWind(spot, spot.rideBearing)).toBe('offshore');
      expect(evaluateWind(spot, (spot.rideBearing + 90) % 360)).toBe('sideshore');
      expect(evaluateWind(spot, (spot.rideBearing + 180) % 360)).toBe('onshore');
      expect(evaluateWind(spot, (spot.rideBearing + 270) % 360)).toBe('sideshore');
    }

    const northFacingSpot = { ...DEFAULT_SPOTS[0]!, rideBearing: 350 };
    expect(evaluateWind(northFacingSpot, 5)).toBe('offshore');
    expect(evaluateWind(northFacingSpot, 185)).toBe('onshore');
  });

  it('classifies wind from northwest toward southeast along the surfer course as onshore', () => {
    const result = evaluateHour(
      { ...DEFAULT_SPOTS[0]!, rideBearing: 156 },
      { wave_height: [0.5], wave_period: [3.2], wave_direction: [300] },
      { wind_speed_10m: [5.7], wind_direction_10m: [317] },
      0,
      0,
      1_700_000_000,
    );
    expect(result.windType).toBe('onshore');
  });

  it('uses the stated offshore, sideshore, and onshore angular boundaries', () => {
    const spot = { ...DEFAULT_SPOTS[0]!, rideBearing: 0 };
    const evaluateWind = (direction: number) =>
      evaluateHour(
        spot,
        { wave_height: [1], wave_period: [7], wave_direction: [300] },
        { wind_direction_10m: [direction] },
        0,
        0,
        1_700_000_000,
      ).windType;

    expect(evaluateWind(45)).toBe('offshore');
    expect(evaluateWind(46)).toBe('sideshore');
    expect(evaluateWind(134)).toBe('sideshore');
    expect(evaluateWind(135)).toBe('onshore');
  });

  it('rewards wind blowing into the surfer face and penalizes wind at their back', () => {
    const spot = { ...DEFAULT_SPOTS[0]!, rideBearing: 0 };
    const evaluateScore = (direction: number) =>
      evaluateHour(
        spot,
        { wave_height: [1], wave_period: [7], wave_direction: [300] },
        { wind_speed_10m: [3], wind_direction_10m: [direction] },
        0,
        0,
        1_700_000_000,
      ).score;

    expect(evaluateScore(0)).toBeGreaterThan(evaluateScore(180));
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPOTS } from '@surf-check/shared';
import { fetchSpot, fetchSpotHour } from '../apps/api/src/open-meteo.js';

const MARINE_VARIABLES = [
  'wave_height',
  'wave_period',
  'wave_direction',
  'swell_wave_height',
  'swell_wave_period',
  'swell_wave_direction',
  'wind_wave_height',
  'wind_wave_period',
  'wind_wave_direction',
  'sea_surface_temperature',
];
const WEATHER_VARIABLES = [
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'temperature_2m',
  'precipitation_probability',
  'weather_code',
];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Open-Meteo hourly archive', () => {
  it('loads the selected date and hour from historical marine and weather APIs', async () => {
    const firstTimestamp = Date.parse('2025-05-31T22:00:00.000Z') / 1000;
    const timestamps = Array.from({ length: 24 }, (_, index) => firstTimestamp + index * 3600);
    const marine = {
      time: timestamps,
      wave_height: timestamps.map(() => 0.5),
      wave_period: timestamps.map(() => 3.2),
      wave_direction: timestamps.map(() => 292),
      sea_surface_temperature: timestamps.map(() => 13),
    };
    const weather = {
      time: timestamps,
      wind_speed_10m: timestamps.map(() => 5.7),
      wind_gusts_10m: timestamps.map(() => 8),
      wind_direction_10m: timestamps.map(() => 317),
      precipitation_probability: timestamps.map(() => 0),
      weather_code: timestamps.map(() => 0),
    };
    const requests: URL[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requests.push(url);
      return new Response(
        JSON.stringify({ hourly: url.hostname === 'marine-api.open-meteo.com' ? marine : weather }),
        { status: 200 },
      );
    });

    const hour = await fetchSpotHour({ ...DEFAULT_SPOTS[0]!, rideBearing: 156 }, '2025-06-01', 7);
    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.searchParams.get('start_date') === '2025-06-01')).toBe(true);
    expect(requests.every((url) => url.searchParams.get('end_date') === '2025-06-01')).toBe(true);
    expect(
      requests.find((url) => url.hostname === 'historical-forecast-api.open-meteo.com'),
    ).toBeDefined();
    expect(hour.ts).toBe(Date.parse('2025-06-01T05:00:00.000Z') / 1000);
    expect(hour.windDirDeg).toBe(317);
    expect(hour.windType).toBe('onshore');
    expect(hour.scoreBreakdown).toBeDefined();
  });

  it('includes archived hours for today while keeping now and best in the forecast window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-08-14T12:30:00.000Z'));

    const firstTimestamp = Date.parse('2025-08-13T22:00:00.000Z') / 1000;
    const timestamps = Array.from({ length: 120 }, (_, index) => firstTimestamp + index * 3600);
    const marine = {
      time: timestamps,
      wave_height: timestamps.map(() => 0.6),
      wave_period: timestamps.map(() => 6),
      wave_direction: timestamps.map(() => 300),
      swell_wave_height: timestamps.map(() => 0.5),
      swell_wave_period: timestamps.map(() => 6),
      swell_wave_direction: timestamps.map(() => 300),
      wind_wave_height: timestamps.map(() => 0.3),
      wind_wave_period: timestamps.map(() => 4),
      wind_wave_direction: timestamps.map(() => 300),
      sea_surface_temperature: timestamps.map(() => 12),
    };
    const weather = {
      time: timestamps,
      wind_speed_10m: timestamps.map(() => 3),
      wind_gusts_10m: timestamps.map(() => 4),
      wind_direction_10m: timestamps.map(() => 180),
      temperature_2m: timestamps.map(() => 15),
      precipitation_probability: timestamps.map(() => 0),
      weather_code: timestamps.map(() => 0),
    };
    const requests: URL[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requests.push(url);
      return new Response(
        JSON.stringify({ hourly: url.hostname === 'marine-api.open-meteo.com' ? marine : weather }),
        { status: 200 },
      );
    });

    const result = await fetchSpot(DEFAULT_SPOTS[0]!);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kaliningrad',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayHours = result.hours!.filter(
      (hour) => today.format(new Date(hour.ts * 1000)) === '2025-08-14',
    );

    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.searchParams.get('past_days') === '1')).toBe(true);
    expect(
      requests
        .find((url) => url.hostname === 'marine-api.open-meteo.com')
        ?.searchParams.get('hourly')
        ?.split(','),
    ).toEqual(MARINE_VARIABLES);
    expect(
      requests
        .find((url) => url.hostname === 'api.open-meteo.com')
        ?.searchParams.get('hourly')
        ?.split(','),
    ).toEqual(WEATHER_VARIABLES);
    expect(todayHours).toHaveLength(24);
    expect(todayHours[0]!.ts).toBe(firstTimestamp);
    expect(result.now?.ts).toBe(Date.parse('2025-08-14T12:00:00.000Z') / 1000);
    expect(todayHours[0]!.wave).toBe(0.6);
    expect(result.hours!.filter((hour) => hour.ts < result.now!.ts)).toHaveLength(14);
    expect(result.best!.ts).toBeGreaterThanOrEqual(result.now!.ts);
  });
});

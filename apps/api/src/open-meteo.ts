import type { HourForecast, Spot, SpotForecast } from '@surf-check/shared';
import { config } from './config.js';
import { evaluateHour } from './scoring.js';

interface OpenMeteoResponse {
  hourly?: Record<string, (number | null)[] | undefined> & {
    time?: number[];
  };
}

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
].join(',');
const WEATHER_VARIABLES = [
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'temperature_2m',
  'precipitation_probability',
  'weather_code',
].join(',');

async function fetchJson(url: URL): Promise<OpenMeteoResponse> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'KaliningradSurfCheck/2.0',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo ответил HTTP ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as OpenMeteoResponse;
}

function forecastUrl(base: string, spot: Spot): URL {
  const url = new URL(base);
  url.searchParams.set('latitude', String(spot.lat));
  url.searchParams.set('longitude', String(spot.lon));
  url.searchParams.set('timeformat', 'unixtime');
  url.searchParams.set('timezone', 'Europe/Kaliningrad');
  url.searchParams.set('forecast_days', '4');
  return url;
}

async function fetchMarine(spot: Spot): Promise<OpenMeteoResponse> {
  const url = forecastUrl('https://marine-api.open-meteo.com/v1/marine', spot);
  url.searchParams.set('hourly', MARINE_VARIABLES);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'KaliningradSurfCheck/2.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status === 400) {
    const fallback = forecastUrl('https://marine-api.open-meteo.com/v1/marine', spot);
    fallback.searchParams.set('hourly', 'wave_height,wave_period,wave_direction');
    const fallbackResponse = await fetch(fallback, {
      headers: { 'User-Agent': 'KaliningradSurfCheck/2.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!fallbackResponse.ok) {
      throw new Error(
        `Open-Meteo Marine ответил HTTP ${fallbackResponse.status}: ${await fallbackResponse.text()}`,
      );
    }
    return (await fallbackResponse.json()) as OpenMeteoResponse;
  }
  if (!response.ok) {
    throw new Error(`Open-Meteo Marine ответил HTTP ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as OpenMeteoResponse;
}

async function fetchWeather(spot: Spot): Promise<OpenMeteoResponse> {
  const url = forecastUrl('https://api.open-meteo.com/v1/forecast', spot);
  url.searchParams.set('hourly', WEATHER_VARIABLES);
  url.searchParams.set('wind_speed_unit', 'ms');
  return fetchJson(url);
}

export async function fetchSpot(spot: Spot): Promise<SpotForecast> {
  const [marineResponse, weatherResponse] = await Promise.all([
    fetchMarine(spot),
    fetchWeather(spot),
  ]);
  const marine = marineResponse.hourly ?? {};
  const weather = weatherResponse.hourly ?? {};
  const times = marine.time ?? [];
  if (!times.length) throw new Error('Пустой ответ от marine API');

  const weatherTimes = weather.time ?? [];
  const weatherIndex = new Map(weatherTimes.map((timestamp, index) => [timestamp, index]));
  const now = Math.floor(Date.now() / 1000);
  const firstForecastIndex = times.findIndex((timestamp) => timestamp >= now - 1800);
  const forecastStart = firstForecastIndex < 0 ? Math.max(0, times.length - 1) : firstForecastIndex;
  const end = Math.min(times.length, forecastStart + config.forecastHours);
  const hours: HourForecast[] = [];
  let best: HourForecast | null = null;

  for (let index = forecastStart; index < end; index += 1) {
    const timestamp = times[index]!;
    const mappedWeatherIndex = weatherIndex.get(timestamp);
    const resolvedWeatherIndex = mappedWeatherIndex ?? (index < weatherTimes.length ? index : 0);
    const forecastHour = evaluateHour(
      spot,
      marine,
      weather,
      index,
      resolvedWeatherIndex,
      timestamp,
    );
    hours.push(forecastHour);

    if (hours.length <= config.bestWindowHours && !forecastHour.danger) {
      if (
        best === null ||
        forecastHour.score > best.score ||
        (forecastHour.score === best.score && forecastHour.ts < best.ts)
      ) {
        best = forecastHour;
      }
    }
  }

  if (!hours.length) throw new Error('Не удалось рассчитать текущий чек');
  if (best === null) {
    best = hours
      .slice(0, config.bestWindowHours)
      .reduce((current, hour) => (hour.score > current.score ? hour : current));
  }

  return { ...spot, now: hours[0]!, best, hours };
}

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
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '4');
  return url;
}

function datedUrl(base: string, spot: Spot, date: string): URL {
  const url = new URL(base);
  url.searchParams.set('latitude', String(spot.lat));
  url.searchParams.set('longitude', String(spot.lon));
  url.searchParams.set('timeformat', 'unixtime');
  url.searchParams.set('timezone', 'Europe/Kaliningrad');
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  return url;
}

function localDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kaliningrad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localHour(timestamp: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kaliningrad',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp * 1000));
  return Number(parts.find(({ type }) => type === 'hour')?.value);
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

async function fetchMarineDate(spot: Spot, date: string): Promise<OpenMeteoResponse> {
  const url = datedUrl('https://marine-api.open-meteo.com/v1/marine', spot, date);
  url.searchParams.set('hourly', MARINE_VARIABLES);
  try {
    return await fetchJson(url);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('HTTP 400')) throw error;
    const fallback = datedUrl('https://marine-api.open-meteo.com/v1/marine', spot, date);
    fallback.searchParams.set('hourly', 'wave_height,wave_period,wave_direction');
    return fetchJson(fallback);
  }
}

async function fetchWeatherDate(spot: Spot, date: string): Promise<OpenMeteoResponse> {
  const today = localDate(Math.floor(Date.now() / 1000));
  const base =
    date < today
      ? 'https://historical-forecast-api.open-meteo.com/v1/forecast'
      : 'https://api.open-meteo.com/v1/forecast';
  const url = datedUrl(base, spot, date);
  url.searchParams.set('hourly', WEATHER_VARIABLES);
  url.searchParams.set('wind_speed_unit', 'ms');
  return fetchJson(url);
}

export async function fetchSpotHour(spot: Spot, date: string, hour: number): Promise<HourForecast> {
  const [marineResponse, weatherResponse] = await Promise.all([
    fetchMarineDate(spot, date),
    fetchWeatherDate(spot, date),
  ]);
  const marine = marineResponse.hourly ?? {};
  const weather = weatherResponse.hourly ?? {};
  const marineTimes = marine.time ?? [];
  const marineIndex = marineTimes.findIndex(
    (timestamp) => localDate(timestamp) === date && localHour(timestamp) === hour,
  );
  if (marineIndex < 0) {
    throw new Error(
      `Для ${date} ${String(hour).padStart(2, '0')}:00 нет архивных данных о волнах.`,
    );
  }
  const timestamp = marineTimes[marineIndex]!;
  const weatherTimes = weather.time ?? [];
  const weatherIndex = weatherTimes.findIndex((weatherTimestamp) => weatherTimestamp === timestamp);
  if (weatherIndex < 0) {
    throw new Error(
      `Для ${date} ${String(hour).padStart(2, '0')}:00 нет архивных данных о погоде.`,
    );
  }
  return evaluateHour(spot, marine, weather, marineIndex, weatherIndex, timestamp);
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
  const today = localDate(now);
  const firstTodayIndex = times.findIndex((timestamp) => localDate(timestamp) === today);
  if (firstTodayIndex < 0) {
    throw new Error('В ответе Open-Meteo нет архивных данных за сегодня');
  }
  const end = Math.min(times.length, forecastStart + config.forecastHours);
  const hours: HourForecast[] = [];
  let best: HourForecast | null = null;
  let current: HourForecast | null = null;
  let forecastHoursCount = 0;

  for (let index = firstTodayIndex; index < end; index += 1) {
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

    if (index < forecastStart) continue;
    forecastHoursCount += 1;
    if (index === forecastStart) current = forecastHour;
    if (forecastHoursCount <= config.bestWindowHours && !forecastHour.danger) {
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
  if (current === null) throw new Error('В ответе Open-Meteo нет текущего прогноза');
  const currentHour = current;
  if (best === null) {
    best = hours
      .filter((hour) => hour.ts >= currentHour.ts)
      .slice(0, config.bestWindowHours)
      .reduce<HourForecast | null>(
        (currentBest, hour) =>
          currentBest === null || hour.score > currentBest.score ? hour : currentBest,
        null,
      );
    if (best === null) throw new Error('Не удалось найти часы прогноза для текущего окна');
  }

  return { ...spot, now: currentHour, best, hours };
}

import type { BoardType, HourForecast, Spot, WindType } from '@surf-check/shared';

type Numeric = number | null | undefined;
type Curve = readonly (readonly [number, number])[];
type HourlyData = Record<string, (number | null)[] | undefined>;

const HEIGHT_POINTS: Curve = [
  [0, 0],
  [0.25, 10],
  [0.55, 45],
  [0.85, 80],
  [1.25, 100],
  [1.7, 85],
  [2.2, 60],
  [2.8, 30],
  [3.6, 8],
  [4.5, 0],
];
const PERIOD_POINTS: Curve = [
  [0, 0],
  [2.5, 5],
  [3.5, 25],
  [4.5, 55],
  [5.5, 80],
  [6.5, 100],
  [7.5, 95],
  [8.5, 80],
  [10, 55],
  [12, 25],
  [14, 5],
];
const WIND_BASE_POINTS: Curve = [
  [0, 100],
  [2, 96],
  [4, 88],
  [6, 75],
  [8, 58],
  [10, 42],
  [12, 26],
  [14, 12],
  [17, 3],
  [22, 0],
];
const DIRECTION_SCORE_POINTS: Curve = [
  [0, 100],
  [15, 98],
  [30, 86],
  [50, 62],
  [70, 38],
  [95, 14],
  [130, 0],
  [180, 0],
];
const COMPASS_DIRECTIONS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

export function clean(value: Numeric): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value;
}

function clamp(value: Numeric, lower = 0, upper = 100): number {
  const valid = clean(value);
  return valid === null ? 0 : Math.max(lower, Math.min(upper, valid));
}

export function interpolate(value: Numeric, points: Curve): number {
  const valid = clean(value);
  if (valid === null) return 0;
  if (valid <= points[0]![0]) return points[0]![1];
  if (valid >= points.at(-1)![0]) return points.at(-1)![1];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[index + 1]!;
    if (valid <= x2) return y1 + ((y2 - y1) * (valid - x1)) / (x2 - x1);
  }
  return points.at(-1)![1];
}

function angleDifference(first: Numeric, second: Numeric): number {
  const a = clean(first);
  const b = clean(second);
  if (a === null || b === null) return 180;
  return Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);
}

function windToDirection(directionFrom: number): number {
  return (directionFrom + 180) % 360;
}

function bestDifference(degrees: Numeric, targets: number[]): number | null {
  const valid = clean(degrees);
  if (valid === null || !targets.length) return null;
  return Math.min(...targets.map((target) => angleDifference(valid, target)));
}

function waveDirectionDifference(degrees: Numeric, targets: number[]): number | null {
  const valid = clean(degrees);
  if (valid === null || !targets.length) return null;
  const candidates = [
    bestDifference(valid, targets),
    bestDifference((valid + 180) % 360, targets),
  ].filter((difference): difference is number => difference !== null);
  return candidates.length ? Math.min(...candidates) : null;
}

function compass(degrees: Numeric): string {
  const valid = clean(degrees);
  if (valid === null) return '—';
  return COMPASS_DIRECTIONS[Math.floor((valid + 22.5) / 45) % 8]!;
}

function roundOne(value: Numeric): number | null {
  const valid = clean(value);
  return valid === null ? null : Math.round(valid * 10) / 10;
}

function chooseWave(
  height: Numeric,
  period: Numeric,
  direction: Numeric,
  swellHeight: Numeric,
  swellPeriod: Numeric,
  swellDirection: Numeric,
  windWaveHeight: Numeric,
  windWavePeriod: Numeric,
  windWaveDirection: Numeric,
): [number | null, number | null, number | null] {
  let waveHeight = clean(height);
  let wavePeriod = clean(period);
  let waveDirection = clean(direction);
  const swell = clean(swellHeight);
  const swellP = clean(swellPeriod);
  const swellD = clean(swellDirection);
  const windWave = clean(windWaveHeight);
  const windPeriod = clean(windWavePeriod);
  const windDirectionValue = clean(windWaveDirection);

  if (waveHeight === null) {
    const useSwell = (swell ?? 0) >= (windWave ?? 0);
    waveHeight = useSwell ? swell : windWave;
  }
  const useSwell = (swell ?? 0) >= (windWave ?? 0);
  if (wavePeriod === null) wavePeriod = useSwell ? swellP : windPeriod;
  if (waveDirection === null) waveDirection = useSwell ? swellD : windDirectionValue;
  return [waveHeight, wavePeriod, waveDirection];
}

function windScore(speed: Numeric, gust: Numeric, direction: Numeric, rideBearing: number): number {
  const windSpeed = clean(speed);
  const windGust = clean(gust);
  const windDirection = clean(direction);
  const base = windSpeed === null ? 70 : interpolate(windSpeed, WIND_BASE_POINTS);
  if (windDirection === null) return base;

  const windTo = windToDirection(windDirection);
  const onshoreDifference = angleDifference(windTo, rideBearing);
  const offshoreDifference = angleDifference(windTo, (rideBearing + 180) % 360);
  let adjustment = 0;
  if (onshoreDifference <= 45) {
    adjustment -= (1 - onshoreDifference / 45) * 35;
  }
  if (offshoreDifference <= 45) {
    adjustment += (1 - offshoreDifference / 45) * 12;
  }
  if (windGust !== null && windSpeed !== null && windGust > windSpeed + 5) adjustment -= 8;
  if (windGust !== null && windGust > 18) adjustment -= 12;
  return clamp(base + adjustment);
}

function windType(direction: Numeric, rideBearing: number): WindType | null {
  const validDirection = clean(direction);
  if (validDirection === null) return null;

  const difference = angleDifference(windToDirection(validDirection), rideBearing);
  if (difference <= 45) return 'onshore';
  if (difference >= 135) return 'offshore';
  return 'sideshore';
}

function safetyFlags(
  height: Numeric,
  wind: Numeric,
  gust: Numeric,
  weatherCode: Numeric,
): [boolean, string[]] {
  const dangers: string[] = [];
  if (wind !== null && wind !== undefined && wind >= 15) dangers.push('Очень сильный ветер');
  if (gust !== null && gust !== undefined && gust >= 22) dangers.push('Опасные порывы ветра');
  if (height !== null && height !== undefined && height >= 3.5)
    dangers.push('Экстремальная высота волн');
  if (weatherCode !== null && weatherCode !== undefined && [95, 96, 99].includes(weatherCode)) {
    dangers.push('Гроза: сессию лучше отменить');
  }
  return [dangers.length > 0, dangers];
}

function verdict(score: number, danger: boolean): string {
  if (danger) return 'Опасно';
  if (score >= 75) return 'Отлично';
  if (score >= 60) return 'Хорошо';
  if (score >= 45) return 'Можно';
  if (score >= 25) return 'Слабо';
  return 'Нет';
}

function boardType(height: Numeric): BoardType | null {
  const waveHeight = clean(height);
  if (waveHeight === null) return null;
  return waveHeight < 1 ? 'longboard' : 'shortboard';
}

function buildReasons(
  height: number | null,
  period: number | null,
  direction: number | null,
  wind: number | null,
  windDirection: number | null,
  precipitation: number | null,
  weatherCode: number | null,
  dangers: string[],
  spot: Spot,
): string[] {
  const reasons: string[] = [];
  if (height === null) reasons.push('Нет данных о волнении.');
  else if (height < 0.25) reasons.push('Волн почти нет: чек слабый.');
  else if (height < 0.6) reasons.push('Небольшая высота: подходит для лонгборда и обучения.');
  else if (height <= 1.8) reasons.push('Рабочая высота для Балтики.');
  else reasons.push('Большая высота: нужен опыт и осмотр спота.');

  if (period !== null) {
    if (period < 3.5) reasons.push('Короткий период: вероятен чоп и рваная поверхность.');
    else if (period >= 5.5 && period <= 8.5) reasons.push('Хороший период для Балтийского моря.');
    else if (period > 10) reasons.push('Длинный период: возможна редкая, но мощная энергия.');
  }
  const waveDifference = waveDirectionDifference(direction, spot.bestFrom);
  if (waveDifference !== null) {
    if (waveDifference <= 35) reasons.push('Волны приходят с рабочего направления.');
    else if (waveDifference <= 70)
      reasons.push('Направление боковое, качество сильно зависит от ветра.');
    else reasons.push('Направление не совпадает с лучшим окном для спота.');
  }
  if (windDirection !== null) {
    const type = windType(windDirection, spot.rideBearing);
    if (type === 'offshore') reasons.push('Офшор: направление ветра противоположно курсу серфера.');
    else if (type === 'onshore')
      reasons.push('Оншор: направление ветра совпадает с курсом серфера.');
    else if (type === 'sideshore') reasons.push('Сайдшор: ветер дует сбоку.');
  }
  if (wind !== null && wind > 10) reasons.push('Сильный ветер: сложнее с контролем и греблей.');
  if (precipitation !== null && precipitation >= 65) reasons.push('Высокая вероятность осадков.');
  if (weatherCode !== null && [95, 96, 99].includes(weatherCode)) {
    reasons.push('Возможна гроза: лучше не выходить на воду.');
  }
  for (const danger of dangers) if (!reasons.includes(danger)) reasons.push(danger);
  return reasons.slice(0, 6);
}

export function evaluateHour(
  spot: Spot,
  marine: HourlyData,
  weather: HourlyData,
  marineIndex: number,
  weatherIndex: number,
  timestamp: number,
): HourForecast {
  const marineValue = (key: string): number | null => marine[key]?.[marineIndex] ?? null;
  const weatherValue = (key: string): number | null => weather[key]?.[weatherIndex] ?? null;
  const [height, period, direction] = chooseWave(
    marineValue('wave_height'),
    marineValue('wave_period'),
    marineValue('wave_direction'),
    marineValue('swell_wave_height'),
    marineValue('swell_wave_period'),
    marineValue('swell_wave_direction'),
    marineValue('wind_wave_height'),
    marineValue('wind_wave_period'),
    marineValue('wind_wave_direction'),
  );
  const wind = clean(weatherValue('wind_speed_10m'));
  const gust = clean(weatherValue('wind_gusts_10m'));
  const windDirection = clean(weatherValue('wind_direction_10m'));
  const precipitation = clean(weatherValue('precipitation_probability'));
  const weatherCode = clean(weatherValue('weather_code'));
  const seaTemperature = clean(marineValue('sea_surface_temperature'));
  const directionDifference = waveDirectionDifference(direction, spot.bestFrom);
  const directionScore =
    directionDifference === null ? 50 : interpolate(directionDifference, DIRECTION_SCORE_POINTS);
  const waveHeightScore = interpolate(height, HEIGHT_POINTS);
  const periodScore = interpolate(period, PERIOD_POINTS);
  const windComponentScore = windScore(wind, gust, windDirection, spot.rideBearing);
  const overall =
    0.4 * waveHeightScore + 0.22 * periodScore + 0.2 * directionScore + 0.18 * windComponentScore;

  let boundedScore = overall;
  let scoreLimit: number | null = null;
  if (height === null) scoreLimit = 15;
  if (height !== null && height < 0.25) scoreLimit = 8;
  const [danger, dangers] = safetyFlags(height, wind, gust, weatherCode);
  if (danger) scoreLimit = scoreLimit === null ? 12 : Math.min(scoreLimit, 12);
  if (scoreLimit !== null) boundedScore = Math.min(boundedScore, scoreLimit);
  const score = Math.round(clamp(boundedScore));

  return {
    ts: timestamp,
    score,
    scoreBreakdown: {
      waveHeight: waveHeightScore,
      period: periodScore,
      waveDirection: directionScore,
      wind: windComponentScore,
      limit: scoreLimit,
    },
    verdict: verdict(score, danger),
    wave: roundOne(height),
    period: roundOne(period),
    waveDir: compass(direction),
    waveDirDeg: roundOne(direction),
    wind: roundOne(wind),
    gust: roundOne(gust),
    windDir: compass(windDirection),
    windDirDeg: roundOne(windDirection),
    windType: windType(windDirection, spot.rideBearing),
    sst: roundOne(seaTemperature),
    reasons: buildReasons(
      height,
      period,
      direction,
      wind,
      windDirection,
      precipitation,
      weatherCode,
      dangers,
      spot,
    ),
    dangers,
    board: boardType(height),
    danger,
  };
}

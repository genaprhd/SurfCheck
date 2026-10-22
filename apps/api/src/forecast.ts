import type {
  ForecastData,
  ForecastState,
  Spot,
  SpotForecast,
  SummaryForecast,
} from '@surf-check/shared';
import { fetchSpot } from './open-meteo.js';
import { getSpots } from './spots.js';

export const state: ForecastState = {
  data: null,
  updated: 0,
  loading: false,
  error: null,
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function failedForecast(spot: Spot, error: unknown): SpotForecast {
  return { ...spot, error: error instanceof Error ? error.message : String(error) };
}

function buildSummary(spots: SpotForecast[]): ForecastData['summary'] {
  const available = spots.filter(
    (spot): spot is SpotForecast & { now: NonNullable<SpotForecast['now']> } =>
      !spot.error && spot.now !== undefined,
  );
  const bestNow = available.reduce<SummaryForecast | null>((best, spot) => {
    if (best === null || spot.now.score > best.score) return { ...spot.now, spot: spot.name };
    return best;
  }, null);
  const bestNext = available.reduce<SummaryForecast | null>((best, spot) => {
    if (!spot.best) return best;
    if (best === null || spot.best.score > best.score) return { ...spot.best, spot: spot.name };
    return best;
  }, null);
  return { best_now: bestNow, best_next: bestNext };
}

export async function refreshForecast(): Promise<boolean> {
  if (state.loading) return false;
  state.loading = true;
  state.error = null;
  try {
    const configuredSpots = getSpots();
    const results = await mapWithConcurrency(configuredSpots, 6, async (spot) => {
      try {
        return await fetchSpot(spot);
      } catch (error) {
        console.error(`Forecast failed for spot ${spot.id}:`, error);
        return failedForecast(spot, error);
      }
    });
    const data: ForecastData = {
      spots: results,
      summary: buildSummary(results),
      source: 'Open-Meteo Marine + Forecast',
      timezone: 'Europe/Kaliningrad',
      disclaimer:
        'Это модельный прогноз для районов побережья, а не проверенные названия серф-брейков. Перед выходом сверяйте условия на месте, ветер, течение и безопасность.',
    };
    state.data = data;
    state.updated = Math.floor(Date.now() / 1000);
    return true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    return false;
  } finally {
    state.loading = false;
  }
}

export function startRefresh(): boolean {
  if (state.loading) return false;
  void refreshForecast();
  return true;
}

export function configureRefreshInterval(): NodeJS.Timeout {
  return setInterval(
    () => {
      if (!state.loading) void refreshForecast();
    },
    5 * 60 * 1000,
  );
}

import { z } from 'zod';

export const SpotSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  note: z.string().max(160).default(''),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  bestFrom: z.array(z.number().finite().min(0).max(360)).min(1),
  offshore: z.array(z.number().finite().min(0).max(360)).min(1),
});

export const SpotsSchema = z
  .array(SpotSchema)
  .min(1)
  .max(40)
  .superRefine((spots, context) => {
    const ids = new Set<string>();
    spots.forEach((spot, index) => {
      if (ids.has(spot.id)) {
        context.addIssue({
          code: 'custom',
          message: `Идентификатор точки «${spot.id}» повторяется.`,
          path: [index, 'id'],
        });
      }
      ids.add(spot.id);
    });
  });

export type Spot = z.infer<typeof SpotSchema>;

export interface HourForecast {
  ts: number;
  score: number;
  verdict: string;
  wave: number | null;
  period: number | null;
  waveDir: string;
  waveDirDeg: number | null;
  wind: number | null;
  gust: number | null;
  windDir: string;
  sst: number | null;
  reasons: string[];
  dangers: string[];
  gear: string;
  level: string;
  danger: boolean;
}

export interface SpotForecast extends Spot {
  now?: HourForecast;
  best?: HourForecast | null;
  hours?: HourForecast[];
  error?: string;
}

export interface SummaryForecast extends HourForecast {
  spot: string;
}

export interface ForecastData {
  spots: SpotForecast[];
  summary: {
    best_now: SummaryForecast | null;
    best_next: SummaryForecast | null;
  };
  source: string;
  timezone: string;
  disclaimer: string;
}

export interface ForecastState {
  data: ForecastData | null;
  updated: number;
  loading: boolean;
  error: string | null;
}

export const DEFAULT_SPOTS: Spot[] = [
  {
    id: 'zelenogradsk',
    name: 'Зеленоградск',
    note: 'Балтийский берег · район Зеленоградска',
    lat: 54.965,
    lon: 20.472,
    bestFrom: [300, 340, 20],
    offshore: [135, 180, 225],
  },
  {
    id: 'pionersky',
    name: 'Пионерский',
    note: 'Балтийский берег · район Пионерского',
    lat: 54.952,
    lon: 20.223,
    bestFrom: [280, 320, 0],
    offshore: [140, 180, 220],
  },
  {
    id: 'svetlogorsk',
    name: 'Светлогорск',
    note: 'Балтийский берег · район Светлогорска',
    lat: 54.944,
    lon: 20.152,
    bestFrom: [280, 320, 0],
    offshore: [140, 180, 220],
  },
  {
    id: 'yantarny',
    name: 'Янтарный',
    note: 'Балтийский берег · район Янтарного',
    lat: 54.869,
    lon: 19.938,
    bestFrom: [250, 290, 330],
    offshore: [70, 110, 150],
  },
  {
    id: 'baltiysk',
    name: 'Балтийск',
    note: 'Балтийский берег · район Балтийска',
    lat: 54.663,
    lon: 19.911,
    bestFrom: [230, 270, 310],
    offshore: [50, 90, 130],
  },
  {
    id: 'kurshskaya_kosa',
    name: 'Куршская коса · Рыбачий',
    note: 'Балтийский берег · район посёлка Рыбачий',
    lat: 55.159,
    lon: 20.613,
    bestFrom: [270, 310, 350],
    offshore: [90, 135, 180],
  },
];

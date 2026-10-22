import type { ForecastState, HourForecast, Spot } from '@surf-check/shared';

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    cache: 'no-store',
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : `Backend ответил HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export const api = {
  state: () => request<ForecastState>('/api/state'),
  refresh: () => request<ForecastState>('/api/refresh'),
  spots: async () => (await request<{ spots: Spot[] }>('/api/spots')).spots,
  methodologyHour: (spotId: string, date: string, hour: number) => {
    const query = new URLSearchParams({ spotId, date, hour: String(hour) });
    return request<{ hour: HourForecast }>(`/api/methodology?${query.toString()}`);
  },
  authenticate: (token: string) =>
    request<{ authenticated: true }>('/api/auth', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
  saveSpots: (spots: Spot[], token: string) =>
    request<{ spots: Spot[]; loading: boolean }>('/api/spots', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ spots }),
    }),
};

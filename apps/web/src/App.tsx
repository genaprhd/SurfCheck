import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import L, { type Map as LeafletMap, type Marker } from 'leaflet';
import {
  SpotsSchema,
  type ForecastState,
  type HourForecast,
  type Spot,
  type SpotForecast,
} from '@surf-check/shared';
import { ApiError, api } from './api.js';

const EMPTY_STATE: ForecastState = { data: null, updated: 0, loading: false, error: null };
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2 * 1000;
const RETRY_INTERVAL_MS = 5 * 1000;
const CARD_VIEW_STORAGE_KEY = 'surfCheckCardViewV2';
const MAX_SPOTS = 40;
const SPOT_PHOTOS: Record<string, string> = {
  zelenogradsk:
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
  pionersky:
    'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=900&q=80',
  svetlogorsk:
    'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80',
  yantarny:
    'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80',
  baltiysk:
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
  kurshskaya_kosa:
    'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=900&q=80',
  custom_ca115552732249948726:
    'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80',
};

type CoastIconName =
  'wave' | 'calendar' | 'bolt' | 'gauge' | 'map' | 'star' | 'user' | 'refresh' | 'pin' | 'clock';

function CoastIcon({ name }: { name: CoastIconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };
  const iconPaths: Record<CoastIconName, ReactNode> = {
    wave: (
      <>
        <path d="M3 14c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2 2.2 2 4.4 2" />
        <path d="M4 18c1.7 0 2.2-1.2 3.1-2.1M9.2 9.8a5.2 5.2 0 0 1 9.7 2.5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
        <path d="M7.5 3v4M16.5 3v4M4 9.5h16M8 13h2M14 13h2M8 17h2" />
      </>
    ),
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
    gauge: (
      <>
        <path d="M4.5 18a8 8 0 1 1 15 0" />
        <path d="m12 13 4-4M7 18h10" />
        <circle cx="12" cy="13" r="1" />
      </>
    ),
    map: (
      <>
        <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
        <path d="M9 3v15M15 6v15" />
      </>
    ),
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
    user: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.8 9a7 7 0 0 1 11.8-2L20 12M4 12l2.4 5a7 7 0 0 0 11.8-2" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
  };
  return (
    <svg className="coast-icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {iconPaths[name]}
    </svg>
  );
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Kaliningrad',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function localDateInput(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kaliningrad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localHourInput(timestamp: number): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kaliningrad',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp * 1000));
  return Number(hour);
}

function windTypeLabel(type: HourForecast['windType'] | undefined): string {
  if (type === 'offshore') return 'Офшор';
  if (type === 'onshore') return 'Оншор';
  if (type === 'sideshore') return 'Сайдшор';
  return 'Ветер';
}

function boardLabel(board: HourForecast['board'] | undefined): string {
  if (board === 'longboard') return 'Лонг';
  if (board === 'shortboard') return 'Шорт';
  return '—';
}

function compassLabel(degrees: number): string {
  const directions = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  return directions[Math.round(degrees / 45) % directions.length]!;
}

function angleDifference(first: number, second: number): number {
  return Math.abs(((((first - second + 180) % 360) + 360) % 360) - 180);
}

function formatFull(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Kaliningrad',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function scoreClass(score: number): string {
  if (score >= 75) return 'good';
  if (score >= 45) return 'ok';
  return 'bad';
}

function barClass(score: number): string {
  if (score >= 65) return 'good';
  if (score >= 40) return 'ok';
  return 'bad';
}

function display(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined || value === '') return '—';
  return value;
}

function useModal(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };
  const handleBackdrop = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  return { dialogRef, handleCancel, handleBackdrop };
}

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
  onLogin: (token: string) => Promise<void>;
}

function LoginDialog({ open, onClose, onLogin }: LoginDialogProps) {
  const { dialogRef, handleCancel, handleBackdrop } = useModal(open, onClose);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setToken('');
      setError('');
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onLogin(token.trim());
    } catch (cause) {
      setError(`Не удалось войти: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      className="login-dialog"
      ref={dialogRef}
      aria-labelledby="login-title"
      onCancel={handleCancel}
      onClick={handleBackdrop}
    >
      <form onSubmit={submit}>
        <h2 id="login-title">Вход в админку</h2>
        <p className="editor-hint">
          Введите токен, настроенный на backend. После входа он останется в этой вкладке.
        </p>
        <label htmlFor="admin-token">Токен администратора</label>
        <input
          id="admin-token"
          type="password"
          autoComplete="current-password"
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        {error && (
          <div className="editor-message" role="alert">
            {error}
          </div>
        )}
        <div className="login-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? 'Проверка…' : 'Войти'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function ScoreMethodologyDialog({
  open,
  onClose,
  spots,
}: {
  open: boolean;
  onClose: () => void;
  spots: SpotForecast[];
}) {
  const { dialogRef, handleCancel, handleBackdrop } = useModal(open, onClose);
  const [spotId, setSpotId] = useState(spots[0]?.id ?? '');
  const [date, setDate] = useState(() => localDateInput(Math.floor(Date.now() / 1000)));
  const [hourOfDay, setHourOfDay] = useState(() => localHourInput(Math.floor(Date.now() / 1000)));
  const [hour, setHour] = useState<HourForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selectedSpot = spots.find((spot) => spot.id === spotId) ?? null;
  const windAngleDifference =
    hour?.windDirDeg === null || hour?.windDirDeg === undefined || !selectedSpot
      ? null
      : angleDifference((hour.windDirDeg + 180) % 360, selectedSpot.rideBearing);
  useEffect(() => {
    if (!open || !spots.length || spots.some((spot) => spot.id === spotId)) return;
    setSpotId(spots.find((spot) => !spot.error)?.id ?? spots[0]!.id);
  }, [open, spotId, spots]);
  useEffect(() => {
    if (!open || !spotId || !date) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void api
        .methodologyHour(spotId, date, hourOfDay)
        .then(({ hour: selectedHour }) => {
          if (active) setHour(selectedHour);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setHour(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [date, hourOfDay, open, spotId]);
  const breakdown = hour?.scoreBreakdown;
  const parts = breakdown
    ? [
        {
          label: 'Высота волны',
          input: `${display(hour?.wave)} м`,
          score: breakdown.waveHeight,
          weight: 0.4,
        },
        {
          label: 'Период волны',
          input: `${display(hour?.period)} с`,
          score: breakdown.period,
          weight: 0.22,
        },
        {
          label: 'Направление волны',
          input: `${display(hour?.waveDir)} · ${display(hour?.waveDirDeg)}°; рабочий сектор ${selectedSpot?.bestFrom.join('°, ')}°`,
          score: breakdown.waveDirection,
          weight: 0.2,
        },
        {
          label: 'Ветер',
          input: `${display(hour?.wind)} м/с, порывы ${display(hour?.gust)} м/с; ${windTypeLabel(hour?.windType)}. Источник: ${display(hour?.windDir)} · ${display(hour?.windDirDeg)}°; поток: ${hour?.windDirDeg === null || hour?.windDirDeg === undefined ? '—' : compassLabel((hour.windDirDeg + 180) % 360)} · ${hour?.windDirDeg === null || hour?.windDirDeg === undefined ? '—' : (hour.windDirDeg + 180) % 360}°; курс ${selectedSpot?.rideBearing}°; разница ${windAngleDifference === null ? '—' : `${windAngleDifference}°`}`,
          score: breakdown.wind,
          weight: 0.18,
        },
      ]
    : [];
  const weightedTotal = parts.reduce((total, part) => total + part.score * part.weight, 0);

  return (
    <dialog
      className="methodology-dialog"
      ref={dialogRef}
      aria-labelledby="methodology-title"
      onCancel={handleCancel}
      onClick={handleBackdrop}
    >
      <div className="methodology-header">
        <div>
          <p className="eyebrow">Как читать прогноз</p>
          <h2 id="methodology-title">Как считается оценка часа</h2>
        </div>
        <button className="editor-close" type="button" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="methodology-content">
        <p>
          Для каждого спота и часа API берёт почасовые данные Open-Meteo Marine и Forecast,
          оценивает четыре фактора по шкале 0–100 и складывает их с разными весами.
        </p>
        <div className="methodology-selectors">
          <label>
            Спот
            <select value={spotId} onChange={(event) => setSpotId(event.target.value)}>
              {spots.map((spot) => (
                <option value={spot.id} key={spot.id}>
                  {spot.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Дата
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Час (Калининград)
            <select
              value={hourOfDay}
              onChange={(event) => setHourOfDay(Number(event.target.value))}
            >
              {Array.from({ length: 24 }, (_, value) => (
                <option value={value} key={value}>
                  {String(value).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <p role="status">Запрашиваю данные для выбранного часа…</p>
        ) : error ? (
          <p className="methodology-warning" role="alert">
            {error}
          </p>
        ) : hour && selectedSpot ? (
          <section className="methodology-example" aria-label="Разбор выбранного часа">
            <h3>
              {selectedSpot.name} · {formatFull(hour.ts)}
            </h3>
            <div className="methodology-rows">
              {parts.map((part) => (
                <div className="methodology-row" key={part.label}>
                  <div>
                    <strong>{part.label}</strong>
                    <span>{part.input}</span>
                  </div>
                  <div className="methodology-math">
                    <span>{part.score.toFixed(1)}/100</span>
                    <span>× {Math.round(part.weight * 100)}%</span>
                    <strong>{(part.score * part.weight).toFixed(1)} балла</strong>
                  </div>
                </div>
              ))}
            </div>
            <div className="methodology-total">
              <span>
                Сумма: {weightedTotal.toFixed(1)}
                {breakdown?.limit !== null && breakdown?.limit !== undefined
                  ? ` · ограничение сверху ${breakdown.limit}`
                  : ''}
              </span>
              <strong>
                Итог: {hour.score}/100 · {hour.verdict}
              </strong>
            </div>
            {hour.danger && (
              <p className="methodology-warning">
                Есть опасный фактор; итоговая оценка ограничена сверху 12 баллами.
              </p>
            )}
          </section>
        ) : (
          <p className="methodology-warning">Выберите спот, дату и час для загрузки расчёта.</p>
        )}
        <section className="methodology-notes">
          <h3>Что означают компоненты</h3>
          <ul>
            <li>
              <strong>Высота волны (40%)</strong> — оценивается по кривой: максимум около 1,25 м,
              слишком маленькая и большая волна снижает балл.
            </li>
            <li>
              <strong>Период (22%)</strong> — интервал между волнами; максимум оценки около 6,5 с.
            </li>
            <li>
              <strong>Направление волны (20%)</strong> — близость к рабочим направлениям,
              настроенным для спота.
            </li>
            <li>
              <strong>Ветер (18%)</strong> — скорость, направление относительно курса и порывы.
              Метеорологический азимут указывает, откуда дует ветер; для классификации используем
              направление потока, развёрнутое на 180°. Поток в пределах 45° от курса — оншор,
              противоположно курсу (135–180°) — офшор, боком — сайдшор. На компасе стрелка
              показывает, куда ветер дует.
            </li>
          </ul>
          <p>
            Температура воды, доска и объяснения условий показываются отдельно и напрямую не входят
            в сумму. Высота волны ниже 0,25 м ограничивает оценку 8 баллами; без данных о волне —
            15; при опасных условиях — 12. Вердикты: 75+ «Отлично», 60+ «Хорошо», 45+ «Можно», 25+
            «Слабо», ниже — «Нет». Это модельная оценка, а не гарантия условий или безопасности.
          </p>
        </section>
      </div>
    </dialog>
  );
}

interface EditorDialogProps {
  open: boolean;
  initialSelectedId: string | null;
  spots: Spot[];
  onSpotsChange: (spots: Spot[]) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  busy: boolean;
  message: string;
  setMessage: (message: string) => void;
}

function SpotEditorDialog({
  open,
  initialSelectedId,
  spots,
  onSpotsChange,
  onClose,
  onSave,
  busy,
  message,
  setMessage,
}: EditorDialogProps) {
  const { dialogRef } = useModal(open, onClose);
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const spotsRef = useRef(spots);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const placingRef = useRef(placing);
  const selected = spots.find((spot) => spot.id === selectedId);

  useEffect(() => {
    if (open) {
      setSelectedId(initialSelectedId);
      setPlacing(false);
      setDirty(false);
    }
  }, [open, initialSelectedId]);

  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);
  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  useEffect(() => {
    if (!open || !mapElement.current || mapRef.current) return;
    const map = L.map(mapElement.current, { zoomAnimation: false }).setView([54.92, 20.25], 8);
    mapRef.current = map;
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
    ).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    const onMapClick = (event: L.LeafletMouseEvent) => {
      if (!placingRef.current) return;
      const { lat, lng } = event.latlng;
      const currentSpots = spotsRef.current;
      const closest = currentSpots.reduce<Spot | null>((result, spot) => {
        if (!result) return spot;
        const distance = (candidate: Spot) =>
          Math.hypot((candidate.lat - lat) * Math.cos((lat * Math.PI) / 180), candidate.lon - lng);
        return distance(spot) < distance(result) ? spot : result;
      }, null);
      const spot: Spot = {
        id: `custom_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
        name: 'Новая точка',
        note: 'Пользовательская точка прогноза',
        lat,
        lon: lng,
        bestFrom: [...(closest?.bestFrom ?? [270, 310, 350])],
        rideBearing: closest?.rideBearing ?? 0,
      };
      onSpotsChange([...spotsRef.current, spot]);
      setSelectedId(spot.id);
      setPlacing(false);
      setDirty(true);
    };
    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
      map.stop();
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, [open, onSpotsChange]);

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!open || !map || !markers) return;
    markers.clearLayers();
    for (const spot of spots) {
      const marker = L.marker([spot.lat, spot.lon], {
        draggable: true,
        title: spot.name,
      }).addTo(markers);
      marker.on('click', () => {
        setSelectedId(spot.id);
        setPlacing(false);
      });
      marker.on('dragend', (event: L.LeafletEvent) => {
        const position = (event.target as Marker).getLatLng();
        onSpotsChange(
          spotsRef.current.map((item) =>
            item.id === spot.id ? { ...item, lat: position.lat, lon: position.lng } : item,
          ),
        );
        setSelectedId(spot.id);
        setDirty(true);
      });
      if (spot.id === selectedId) marker.bindTooltip(spot.name).openTooltip();
    }
  }, [open, spots, selectedId, onSpotsChange]);

  useEffect(() => {
    if (!open || !mapRef.current) return;
    const map = mapRef.current;
    const spotsBounds = L.featureGroup(
      spots.map((spot) => L.marker([spot.lat, spot.lon])),
    ).getBounds();
    if (spotsBounds.isValid()) {
      map.fitBounds(spotsBounds.pad(0.18), { maxZoom: 10, animate: false });
    }
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  function close() {
    if (dirty && !window.confirm('Есть несохранённые изменения. Закрыть без сохранения?')) return;
    setDirty(false);
    setSelectedId(null);
    setMessage('');
    onClose();
  }

  function updateSelected(patch: Partial<Pick<Spot, 'name' | 'lat' | 'lon' | 'rideBearing'>>) {
    if (!selected) return;
    const next = spots.map((spot) => (spot.id === selected.id ? { ...spot, ...patch } : spot));
    onSpotsChange(next);
    setDirty(true);
  }

  function setShoreBearingFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (!selected) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const degrees = (Math.round((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
    updateSelected({ rideBearing: degrees });
  }

  function adjustShoreBearing(event: KeyboardEvent<HTMLDivElement>) {
    if (!selected) return;
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: 10,
      PageDown: -10,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    updateSelected({ rideBearing: (selected.rideBearing + step + 360) % 360 });
  }

  return (
    <dialog
      className="editor-dialog"
      ref={dialogRef}
      aria-labelledby="editor-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="editor-header">
        <div>
          <h2 className="editor-title" id="editor-title">
            Точки прогноза
          </h2>
          <p className="editor-hint">Перетаскивайте маркеры или добавьте новую точку на карте.</p>
        </div>
        <button className="editor-close" type="button" aria-label="Закрыть" onClick={close}>
          ×
        </button>
      </div>
      <div className="editor-layout">
        <div
          className="spot-map"
          ref={mapElement}
          id="spot-map"
          aria-label="Карта точек прогноза"
        />
        <aside className="editor-panel">
          <button
            className="button secondary"
            type="button"
            disabled={spots.length >= MAX_SPOTS}
            onClick={() => {
              setPlacing(true);
              setSelectedId(null);
              setMessage('');
            }}
          >
            + Добавить карточку
          </button>
          <div className="editor-instruction" role="status">
            {placing
              ? 'Нажмите на карту в месте новой точки.'
              : 'Выберите маркер на карте, чтобы изменить название или координаты.'}
          </div>
          <label htmlFor="spot-name">Название карточки</label>
          <input
            id="spot-name"
            maxLength={80}
            autoComplete="off"
            placeholder="Например, Зеленоградск"
            value={selected?.name ?? ''}
            onChange={(event) => updateSelected({ name: event.target.value })}
          />
          <div className="coordinate-grid">
            <div>
              <label htmlFor="spot-lat">Широта</label>
              <input
                id="spot-lat"
                type="number"
                min="-90"
                max="90"
                step="any"
                value={selected?.lat ?? ''}
                onChange={(event) =>
                  updateSelected({
                    lat: event.target.value === '' ? Number.NaN : Number(event.target.value),
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="spot-lon">Долгота</label>
              <input
                id="spot-lon"
                type="number"
                min="-180"
                max="180"
                step="any"
                value={selected?.lon ?? ''}
                onChange={(event) =>
                  updateSelected({
                    lon: event.target.value === '' ? Number.NaN : Number(event.target.value),
                  })
                }
              />
            </div>
          </div>
          {selected && (
            <section className="shore-control" aria-labelledby="ride-direction-label">
              <div>
                <label id="ride-direction-label">Куда едет серфер</label>
                <p className="shore-hint">
                  Укажите направление от лайнапа туда, куда едете по волне.
                </p>
              </div>
              <div className="shore-control-layout">
                <div
                  className="shore-compass"
                  role="slider"
                  tabIndex={0}
                  aria-label="Направление движения серфера по волне"
                  aria-valuemin={0}
                  aria-valuemax={359}
                  aria-valuenow={selected.rideBearing}
                  aria-valuetext={`${compassLabel(selected.rideBearing)}, ${selected.rideBearing} градусов`}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setShoreBearingFromPointer(event);
                  }}
                  onPointerMove={(event) => {
                    if (event.buttons) setShoreBearingFromPointer(event);
                  }}
                  onKeyDown={adjustShoreBearing}
                >
                  <svg viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r="46" className="shore-compass-bg" />
                    <text x="50" y="13" textAnchor="middle">
                      С
                    </text>
                    <text x="87" y="54" textAnchor="middle">
                      В
                    </text>
                    <text x="50" y="94" textAnchor="middle">
                      Ю
                    </text>
                    <text x="13" y="54" textAnchor="middle">
                      З
                    </text>
                    <g transform={`rotate(${selected.rideBearing} 50 50)`}>
                      <path d="M50 68 L50 33" className="shore-arrow-shaft" />
                      <path d="M50 25 L40 42 L50 37 L60 42 Z" className="shore-arrow-head" />
                    </g>
                    <circle cx="50" cy="50" r="4" className="shore-compass-center" />
                  </svg>
                </div>
                <div className="shore-bearing-input">
                  <strong>{compassLabel(selected.rideBearing)}</strong>
                  <label className="sr-only" htmlFor="ride-bearing">
                    Направление движения серфера в градусах
                  </label>
                  <div className="shore-degree-field">
                    <input
                      id="ride-bearing"
                      type="number"
                      min="0"
                      max="359"
                      step="1"
                      value={selected.rideBearing}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isInteger(value) && value >= 0 && value <= 359) {
                          updateSelected({ rideBearing: value });
                        }
                      }}
                    />
                    <span>°</span>
                  </div>
                </div>
              </div>
              <div className="shore-hint">
                Оншор — ветер в спину · сайдшор — сбоку · офшор — в лицо.
              </div>
            </section>
          )}
          {message && (
            <div className="editor-message" role="alert">
              {message}
            </div>
          )}
          <button
            className="button editor-save"
            type="button"
            disabled={busy}
            onClick={() => void onSave()}
          >
            {busy ? 'Сохраняю…' : 'Сохранить изменения'}
          </button>
        </aside>
      </div>
      <div className="editor-footer">
        Карта: © OpenStreetMap contributors · Новые точки наследуют профиль ближайшего спота ·
        Изменения сохраняются на сервере
      </div>
    </dialog>
  );
}

function waveCompass(degrees: number | null, direction: string): ReactNode {
  if (degrees === null) {
    return (
      <div className="wave-panel">
        <div className="wave-reading">
          <div className="wave-label">Направление волны</div>
          <div className="wave-value">Нет данных</div>
        </div>
      </div>
    );
  }
  const label = `${Math.round(degrees)}°${direction ? ` · ${direction}` : ''}`;
  return (
    <div className="wave-panel">
      <svg
        className="wave-compass"
        viewBox="0 0 88 88"
        role="img"
        aria-label={`Направление волны по модели: ${label}`}
      >
        <title>Угол по данным модели: от севера по часовой стрелке</title>
        <circle cx="44" cy="44" r="39" fill="var(--card)" stroke="var(--line)" strokeWidth="1.5" />
        <circle cx="44" cy="44" r="27" fill="none" stroke="var(--line)" strokeWidth="1" />
        <text x="44" y="14" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
          С
        </text>
        <text x="74" y="47" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
          В
        </text>
        <text x="44" y="81" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
          Ю
        </text>
        <text x="14" y="47" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
          З
        </text>
        <g transform={`rotate(${degrees} 44 44)`}>
          <path
            d="M44 62 L44 26"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path d="M44 20 L35 34 L44 30 L53 34 Z" fill="var(--accent)" />
        </g>
        <circle cx="44" cy="44" r="4" fill="var(--card)" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <div className="wave-reading">
        <div className="wave-label">Направление волны · угол модели</div>
        <div className="wave-value">{label}</div>
        <div className="wave-sub">Стрелка показывает угол в градусах от севера</div>
      </div>
    </div>
  );
}

function directionCompass(degrees: number | null | undefined, ariaLabel: string): ReactNode {
  return (
    <svg className="wind-compass" viewBox="0 0 88 88" role="img" aria-label={ariaLabel}>
      <circle cx="44" cy="44" r="39" fill="var(--card)" stroke="var(--line)" strokeWidth="1.5" />
      <text x="44" y="14" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
        С
      </text>
      <text x="74" y="47" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
        В
      </text>
      <text x="44" y="81" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
        Ю
      </text>
      <text x="14" y="47" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700">
        З
      </text>
      {degrees !== null && degrees !== undefined && (
        <g transform={`rotate(${degrees} 44 44)`}>
          <path
            d="M44 62 L44 26"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path d="M44 20 L35 34 L44 30 L53 34 Z" fill="var(--accent)" />
        </g>
      )}
      <circle cx="44" cy="44" r="4" fill="var(--card)" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

function windCompass(hour: HourForecast | undefined, rideBearing: number | undefined): ReactNode {
  const degrees = hour?.windDirDeg ?? null;
  const windToDegrees = degrees === null ? null : (degrees + 180) % 360;
  const windToDirection = windToDegrees === null ? '' : compassLabel(windToDegrees);
  const direction = hour?.windDir ?? '';
  const rideDirection = rideBearing === undefined ? '—' : compassLabel(rideBearing);
  return (
    <div className="wind-panel">
      <div className="wind-direction-item">
        {directionCompass(
          windToDegrees,
          degrees === null
            ? 'Направление ветра: нет данных'
            : `Куда дует ветер: ${Math.round(windToDegrees!)}° ${windToDirection}; ветер приходит из ${Math.round(degrees)}° ${direction}`,
        )}
        <div className="wave-reading">
          <div className="wave-label">Ветер · куда дует</div>
          <div className={`wind-value wind-type ${hour?.windType ?? 'unknown'}`}>
            {windTypeLabel(hour?.windType)}
          </div>
          <div className="wave-sub">
            {degrees === null
              ? 'Нет данных'
              : `Из ${direction} ${Math.round(degrees)}° → ${windToDirection} ${Math.round(windToDegrees!)}° · ${display(hour?.wind)} м/с`}
          </div>
        </div>
      </div>
      <div className="wind-direction-item ride-direction-item">
        {directionCompass(
          rideBearing,
          rideBearing === undefined
            ? 'Направление движения серфера: нет данных'
            : `Направление движения серфера: ${rideDirection}, ${rideBearing}°`,
        )}
        <div className="wave-reading">
          <div className="wave-label">Куда едет серфер</div>
          <div className="wind-value">{rideDirection}</div>
          <div className="wave-sub">
            {rideBearing === undefined ? 'Нет данных' : `${Math.round(rideBearing)}° от севера`}
          </div>
        </div>
      </div>
    </div>
  );
}

type CoastFilter = 'all' | 'available' | 'rideable' | 'dangerous';

function Summary({
  data,
  onOpenMethodology,
  activeFilter,
  onFilterChange,
  onOpenForecast,
}: {
  data: NonNullable<ForecastState['data']>;
  onOpenMethodology: () => void;
  activeFilter: CoastFilter;
  onFilterChange: (filter: CoastFilter) => void;
  onOpenForecast: (spot: SpotForecast, hourTimestamp?: number) => void;
}) {
  const spots = data.spots;
  const available = spots.filter((spot) => !spot.error && spot.now);
  const rideable = available.filter(
    (spot) => !spot.now?.danger && (spot.now?.score ?? 0) >= 45,
  ).length;
  const dangerous = available.filter((spot) => spot.now?.danger).length;
  const average = available.length
    ? Math.round(
        available.reduce((sum, spot) => sum + (spot.now?.score ?? 0), 0) / available.length,
      )
    : null;
  const bestNow = data.summary.best_now;
  const bestNext = data.summary.best_next;
  const bestNowSpot = bestNow ? spots.find((spot) => spot.name === bestNow.spot) : undefined;
  const bestNextSpot = bestNext ? spots.find((spot) => spot.name === bestNext.spot) : undefined;
  return (
    <section className="banner dashboard" aria-labelledby="dashboard-heading">
      <h2 className="dashboard-heading" id="dashboard-heading">
        Сводка по побережью
      </h2>
      <div className="dashboard-stats">
        <button
          className={`dashboard-stat${activeFilter === 'available' ? ' is-active' : ''}`}
          type="button"
          aria-pressed={activeFilter === 'available'}
          onClick={() => onFilterChange(activeFilter === 'available' ? 'all' : 'available')}
        >
          <span className="dashboard-stat-icon">
            <CoastIcon name="wave" />
          </span>
          <span className="dashboard-stat-copy">
            <span>Доступно прогнозов</span>
            <strong>
              {available.length}
              <i> / {spots.length}</i>
            </strong>
          </span>
          <small>Показать споты с данными</small>
        </button>
        <button
          className={`dashboard-stat${activeFilter === 'rideable' ? ' is-active' : ''}`}
          type="button"
          aria-pressed={activeFilter === 'rideable'}
          onClick={() => onFilterChange(activeFilter === 'rideable' ? 'all' : 'rideable')}
        >
          <span className="dashboard-stat-icon">
            <CoastIcon name="calendar" />
          </span>
          <span className="dashboard-stat-copy">
            <span>Можно рассмотреть для сессии</span>
            <strong>{rideable}</strong>
          </span>
          <small>Оценка от 45, без опасных условий</small>
        </button>
        <button
          className={`dashboard-stat${activeFilter === 'dangerous' ? ' is-active' : ''}`}
          type="button"
          aria-pressed={activeFilter === 'dangerous'}
          onClick={() => onFilterChange(activeFilter === 'dangerous' ? 'all' : 'dangerous')}
        >
          <span className="dashboard-stat-icon is-warning">
            <CoastIcon name="bolt" />
          </span>
          <span className="dashboard-stat-copy">
            <span>Опасные условия</span>
            <strong>{dangerous}</strong>
          </span>
          <small>Показать споты с предупреждениями</small>
        </button>
        <button
          className="dashboard-stat dashboard-stat-help"
          type="button"
          onClick={onOpenMethodology}
        >
          <span className="dashboard-stat-icon">
            <CoastIcon name="gauge" />
          </span>
          <span className="dashboard-stat-copy">
            <span>Средняя оценка по доступным спотам</span>
            <strong>
              {average === null ? '—' : average}
              <i>{average === null ? '' : ' / 100'}</i>
            </strong>
          </span>
          <small>Открыть методологию расчёта</small>
        </button>
      </div>
      <div className="hero-grid">
        <button
          className="hero-item hero-item-featured"
          type="button"
          disabled={!bestNow || !bestNowSpot}
          onClick={() => {
            if (bestNow && bestNowSpot) onOpenForecast(bestNowSpot, bestNow.ts);
          }}
        >
          <div className="hero-content">
            <div className="hero-label">
              <CoastIcon name="star" /> Лучший спот сейчас
            </div>
            <div className="hero-value">{bestNow?.spot ?? '—'}</div>
            <div className="hero-detail">
              {bestNow
                ? `${bestNow.verdict} · ${bestNow.score}/100 · волна ${display(bestNow.wave)} м · ветер ${display(bestNow.wind)} м/с`
                : 'Пока нет доступных данных'}
            </div>
            {bestNow && <span className="hero-badge">Лучшие условия сейчас</span>}
          </div>
          <span className="hero-action">
            Открыть прогноз спота <span aria-hidden="true">→</span>
          </span>
        </button>
        <button
          className="hero-item"
          type="button"
          disabled={!bestNext || !bestNextSpot}
          onClick={() => {
            if (bestNext && bestNextSpot) onOpenForecast(bestNextSpot, bestNext.ts);
          }}
        >
          <div className="hero-content">
            <div className="hero-label">
              <CoastIcon name="calendar" /> Лучшее окно на 48 часов
            </div>
            <div className="hero-value">{bestNext?.spot ?? '—'}</div>
            <div className="hero-detail">
              {bestNext
                ? `${formatFull(bestNext.ts)} · ${bestNext.verdict} · ${bestNext.score}/100 · волна ${display(bestNext.wave)} м · ветер ${display(bestNext.wind)} м/с`
                : 'Подходящего прогноза пока нет'}
            </div>
            {bestNext && (
              <span className={`hero-score ${scoreClass(bestNext.score)}`}>
                {bestNext.score}/100
              </span>
            )}
          </div>
          <span className="hero-action">
            Открыть прогноз на этот час <span aria-hidden="true">→</span>
          </span>
        </button>
      </div>
    </section>
  );
}

function dayGroups(hours: HourForecast[]) {
  const groups = new Map<string, HourForecast[]>();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kaliningrad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (const hour of hours) {
    const key = dateFormatter.format(new Date(hour.ts * 1000));
    groups.set(key, [...(groups.get(key) ?? []), hour]);
  }
  return [...groups.entries()].slice(0, 4).map(([date, items], index) => ({
    date,
    label:
      index === 0
        ? 'Сегодня'
        : index === 1
          ? 'Завтра'
          : new Intl.DateTimeFormat('ru-RU', {
              timeZone: 'Europe/Kaliningrad',
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            }).format(new Date(items[0]!.ts * 1000)),
    hours: items,
  }));
}

function ForecastDay({
  spot,
  label,
  hours,
  initialHour,
}: {
  spot: SpotForecast;
  label: string;
  hours: HourForecast[];
  initialHour?: number | undefined;
}) {
  const now = Math.floor(Date.now() / 1000);
  const hourStripElement = useRef<HTMLDivElement>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  useEffect(() => {
    setSelectedHour(
      initialHour !== undefined && hours.some((hour) => hour.ts === initialHour)
        ? initialHour
        : null,
    );
  }, [hours, initialHour]);
  const scrollToHour = (timestamp: number) => {
    setSelectedHour(timestamp);
    const strip = hourStripElement.current;
    const card = strip?.querySelector<HTMLElement>(`[data-hour-ts="${timestamp}"]`);
    if (!strip || !card) return;
    strip.scrollTo({
      left:
        strip.scrollLeft + card.getBoundingClientRect().left - strip.getBoundingClientRect().left,
      behavior: 'smooth',
    });
  };
  useEffect(() => {
    const strip = hourStripElement.current;
    if (!strip) return;
    const animationFrame = window.requestAnimationFrame(() => {
      if (selectedHour !== null && !hours.some((hour) => hour.ts === selectedHour)) {
        setSelectedHour(null);
        return;
      }
      const selectedHourCard =
        selectedHour === null
          ? null
          : strip.querySelector<HTMLElement>(`[data-hour-ts="${selectedHour}"]`);
      const currentHour = strip.querySelector<HTMLElement>('[data-current-hour="true"]');
      const firstHour = strip.querySelector<HTMLElement>('.forecast-card');
      const target = selectedHourCard ?? currentHour ?? firstHour;
      if (!target) return;
      const stripBounds = strip.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      const previewPreviousHour = !selectedHourCard && currentHour ? 48 : 0;
      strip.scrollTo({
        left: Math.min(
          strip.scrollWidth - strip.clientWidth,
          Math.max(
            0,
            strip.scrollLeft + targetBounds.left - stripBounds.left - previewPreviousHour,
          ),
        ),
        behavior: 'auto',
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [hours, selectedHour]);
  if (!hours.length) return <div className="empty">Нет данных для этого дня.</div>;
  const upcomingHours = hours.filter((hour) => hour.ts + 3600 > now);
  const bestHour = (upcomingHours.length ? upcomingHours : hours).reduce((best, hour) =>
    hour.score > best.score ? hour : best,
  );
  const chartTicks = [0, 5, 12, 17, 23].flatMap((hourOfDay) => {
    const index = hours.findIndex((hour) => localHourInput(hour.ts) === hourOfDay);
    return index < 0 ? [] : [{ hour: hours[index]!, index }];
  });
  return (
    <>
      <div className="forecast-day-summary">
        <div>
          <strong>{label}</strong>
          <span>{hours.length} почасовых прогнозов</span>
        </div>
        <div className={`forecast-day-best ${scoreClass(bestHour.score)}`}>
          <span>Лучший час</span>
          <strong>{formatTime(bestHour.ts)}</strong>
          <span>{bestHour.score}/100</span>
        </div>
      </div>
      <div className="forecast-chart" role="group" aria-label="Оценка прогноза по часам">
        {hours.map((hour) => (
          <button
            className={`forecast-bar ${barClass(hour.score)}${hour.ts + 3600 <= now ? ' is-past' : ''}${selectedHour === hour.ts ? ' is-selected' : ''}`}
            style={{ height: `${Math.max(5, hour.score)}%` }}
            title={`${formatFull(hour.ts)} · ${hour.verdict} · ${hour.score}/100${hour.ts + 3600 <= now ? ' · Архив' : ''}`}
            type="button"
            aria-label={`${formatFull(hour.ts)}: ${hour.verdict}, ${hour.score} из 100`}
            aria-pressed={selectedHour === hour.ts}
            onClick={() => scrollToHour(hour.ts)}
            key={hour.ts}
          />
        ))}
      </div>
      <div className="forecast-chart-labels" aria-hidden="true">
        {chartTicks.map(({ hour, index }, tickIndex) => (
          <span
            className={tickIndex === 0 ? 'is-first' : undefined}
            style={{ left: `${(index / Math.max(1, hours.length - 1)) * 100}%` }}
            key={hour.ts}
          >
            {formatTime(hour.ts)}
          </span>
        ))}
      </div>
      <div className="forecast-hours-label">
        <CoastIcon name="wave" />
        Почасовые условия
      </div>
      <div
        className="forecast-hour-strip"
        aria-label="Почасовые карточки прогноза"
        ref={hourStripElement}
      >
        <div className="grid compact forecast-hour-track">
          {hours.map((hour) => (
            <SpotCard
              spot={{
                ...spot,
                name: formatTime(hour.ts),
                note: '',
                now: hour,
                best: null,
                hours: [],
              }}
              onOpenForecast={() => undefined}
              interactive={false}
              historical={hour.ts + 3600 <= now}
              currentHour={hour.ts <= now && now < hour.ts + 3600}
              hourTimestamp={hour.ts}
              hourSelected={selectedHour === hour.ts}
              key={hour.ts}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function ForecastDialog({
  spot,
  onClose,
  onEdit,
  initialHour,
}: {
  spot: SpotForecast | null;
  onClose: () => void;
  onEdit?: (() => void) | undefined;
  initialHour?: number | undefined;
}) {
  const open = spot !== null;
  const { dialogRef, handleCancel, handleBackdrop } = useModal(open, onClose);
  const mapElement = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => dayGroups(spot?.hours ?? []), [spot]);
  const [selectedDay, setSelectedDay] = useState(0);

  useEffect(() => {
    if (!initialHour) {
      setSelectedDay(0);
      return;
    }
    const matchingDay = groups.findIndex((group) =>
      group.hours.some((hour) => hour.ts === initialHour),
    );
    setSelectedDay(Math.max(0, matchingDay));
  }, [groups, initialHour, spot?.id]);

  useEffect(() => {
    if (!open || !spot || !mapElement.current) return;
    const mobileViewport = window.matchMedia('(max-width: 680px)');
    let map: LeafletMap | null = null;
    let invalidateTimer: number | undefined;
    const mountMap = () => {
      if (mobileViewport.matches || map || !mapElement.current) return;
      map = L.map(mapElement.current, { zoomAnimation: false }).setView([spot.lat, spot.lon], 16);
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution:
            'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
      ).addTo(map);
      L.marker([spot.lat, spot.lon]).addTo(map);
      invalidateTimer = window.setTimeout(() => map?.invalidateSize(), 0);
    };
    const unmountMap = () => {
      if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
      map?.stop();
      map?.remove();
      map = null;
    };
    const handleViewportChange = () => {
      if (mobileViewport.matches) unmountMap();
      else mountMap();
    };
    mountMap();
    mobileViewport.addEventListener('change', handleViewportChange);
    return () => {
      mobileViewport.removeEventListener('change', handleViewportChange);
      unmountMap();
    };
  }, [open, spot]);

  const current = spot?.now;
  const mapUrl = spot
    ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(spot.lat)}&mlon=${encodeURIComponent(spot.lon)}#map=12/${encodeURIComponent(spot.lat)}/${encodeURIComponent(spot.lon)}`
    : '#';

  return (
    <dialog
      className="forecast-dialog"
      ref={dialogRef}
      aria-labelledby="forecast-title"
      onCancel={handleCancel}
      onClick={handleBackdrop}
    >
      {spot && (
        <>
          <div className="forecast-dialog-header">
            <div>
              <p className="eyebrow">Подробный прогноз</p>
              <h2 className="forecast-title" id="forecast-title">
                {spot.name}
              </h2>
              <div className="forecast-current">
                <span className={`score ${scoreClass(current?.score ?? 0)}`}>
                  {current?.score ?? 0}
                </span>
                <div className="forecast-current-details">
                  <strong>{current?.verdict ?? '—'}</strong>
                  <span>
                    Волна {display(current?.wave)} м · период {display(current?.period)} с · вода{' '}
                    {display(current?.sst)}°C
                  </span>
                  <span>
                    {windTypeLabel(current?.windType)} · ветер из{' '}
                    {current?.windDirDeg === null || current?.windDirDeg === undefined
                      ? '—'
                      : `${compassLabel(current.windDirDeg)} ${current.windDirDeg}°`}
                    {' → '}
                    {current?.windDirDeg === null || current?.windDirDeg === undefined
                      ? '—'
                      : `${compassLabel((current.windDirDeg + 180) % 360)} ${(current.windDirDeg + 180) % 360}°`}
                    {' · '}
                    {display(current?.wind)} м/с
                  </span>
                </div>
              </div>
            </div>
            <div className="forecast-dialog-actions">
              {onEdit && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Редактировать точку «${spot.name}»`}
                  title="Редактировать точку"
                  onClick={onEdit}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
              <button className="editor-close" type="button" aria-label="Закрыть" onClick={onClose}>
                ×
              </button>
            </div>
          </div>
          <div className="forecast-dialog-content">
            <section className="forecast-map-section" aria-labelledby="forecast-map-heading">
              <div className="forecast-section-heading">
                <h3 id="forecast-map-heading">
                  <CoastIcon name="pin" />
                  Точка на карте
                </h3>
                <a className="map-link" href={mapUrl} target="_blank" rel="noopener noreferrer">
                  Открыть в OpenStreetMap ↗
                </a>
              </div>
              <div id="forecast-map" ref={mapElement} aria-label="Карта выбранной точки" />
              <div className="forecast-coordinates">
                {spot.lat.toFixed(5)}, {spot.lon.toFixed(5)}
              </div>
            </section>
            <section className="forecast-hours-section" aria-labelledby="forecast-hours-heading">
              <h3 id="forecast-hours-heading">
                <CoastIcon name="clock" />
                Прогноз на сегодня и следующие 3 дня
              </h3>
              <div className="forecast-day-tabs" role="tablist" aria-label="Дни прогноза">
                {groups.map((group, index) => (
                  <button
                    className="forecast-day-tab"
                    type="button"
                    role="tab"
                    id={`forecast-tab-${index}`}
                    aria-selected={index === selectedDay}
                    aria-controls="forecast-day-content"
                    onClick={() => setSelectedDay(index)}
                    key={group.date}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
              <div
                id="forecast-day-content"
                role="tabpanel"
                aria-labelledby={`forecast-tab-${selectedDay}`}
              >
                {groups.length ? (
                  <ForecastDay
                    spot={spot}
                    label={groups[selectedDay]?.label ?? ''}
                    hours={groups[selectedDay]?.hours ?? []}
                    initialHour={initialHour}
                  />
                ) : (
                  <div className="empty">Нет данных прогноза.</div>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </dialog>
  );
}

function SpotCard({
  spot,
  onOpenForecast,
  interactive = true,
  historical = false,
  currentHour = false,
  hourTimestamp,
  hourSelected = false,
}: {
  spot: SpotForecast;
  onOpenForecast: (spot: SpotForecast) => void;
  interactive?: boolean;
  historical?: boolean;
  currentHour?: boolean;
  hourTimestamp?: number;
  hourSelected?: boolean;
}) {
  const now = spot.now;
  const best = spot.best;
  const hours = (spot.hours ?? []).filter((hour) => hour.ts >= (now?.ts ?? 0)).slice(0, 48);
  const photo = SPOT_PHOTOS[spot.id];
  const openForecast = () => onOpenForecast(spot);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openForecast();
  };

  return (
    <article
      className={`card forecast-card${spot.error ? ' has-error' : ''}${historical ? ' is-past' : ''}${hourSelected ? ' is-hour-selected' : ''}`}
      data-current-hour={currentHour ? 'true' : undefined}
      data-hour-ts={hourTimestamp}
      data-spot-id={spot.id}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-haspopup={interactive ? 'dialog' : undefined}
      aria-label={interactive ? `Подробный прогноз: ${spot.name}` : undefined}
      onClick={interactive ? openForecast : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
    >
      {photo && hourTimestamp === undefined && (
        <div className="spot-photo">
          <img src={photo} alt="" loading="lazy" decoding="async" />
          <span>Иллюстративное фото</span>
        </div>
      )}
      <div className="card-top">
        <div>
          <h2>{spot.name}</h2>
          <div className="note">{spot.note}</div>
        </div>
        <div className={`score ${spot.error ? 'bad' : scoreClass(now?.score ?? 0)}`}>
          {spot.error ? '!' : (now?.score ?? 0)}
        </div>
      </div>
      <div className="verdict">
        {spot.error ? 'Нет прогноза' : (now?.verdict ?? '—')}
        {historical && <span className="forecast-history-label">История</span>}
      </div>
      {spot.error ? (
        <div className="card-error">{spot.error}</div>
      ) : (
        <>
          <div className="forecast-facts">
            <span>
              Волна <strong>{display(now?.wave)} м</strong>
            </span>
            <span>
              Период <strong>{display(now?.period)} с</strong>
            </span>
            <span>
              Вода <strong>{display(now?.sst)}°C</strong>
            </span>
            <span>
              Доска <strong>{boardLabel(now?.board)}</strong>
            </span>
            <span>
              Порывы <strong>{display(now?.gust)} м/с</strong>
            </span>
          </div>
          {windCompass(now, spot.rideBearing)}
          {waveCompass(now?.waveDirDeg ?? null, now?.waveDir ?? '')}
          <div className="reasons">
            {(now?.reasons.length ? now.reasons : ['Нет деталей.']).map((reason) => (
              <div className="reason" key={reason}>
                {reason}
              </div>
            ))}
          </div>
          <div className="best">
            <strong>Лучшее окно:</strong>{' '}
            {best ? `${formatFull(best.ts)} · ${best.verdict} · ${best.score}/100` : '—'}
          </div>
          <div className="chart">
            {hours.map((hour) => (
              <div
                className={`bar ${barClass(hour.score)}`}
                style={{ height: `${Math.max(8, hour.score)}%` }}
                title={`${formatFull(hour.ts)} · ${hour.verdict} · ${hour.score}/100 · волна ${display(hour.wave)} м · ветер ${display(hour.wind)} м/с`}
                key={hour.ts}
              />
            ))}
          </div>
          <div className="chart-labels">
            <span>{hours.length ? formatTime(hours[0]!.ts) : '—'}</span>
            <span>+48 ч</span>
          </div>
        </>
      )}
    </article>
  );
}

function App() {
  const [state, setState] = useState(EMPTY_STATE);
  const [status, setStatus] = useState('Загружаю данные…');
  const [error, setError] = useState('');
  const [compact, setCompact] = useState(
    () => localStorage.getItem(CARD_VIEW_STORAGE_KEY) !== 'detailed',
  );
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorMessage, setEditorMessage] = useState('');
  const [editorSpots, setEditorSpots] = useState<Spot[]>([]);
  const [editorSelectedId, setEditorSelectedId] = useState<string | null>(null);
  const [selectedForecast, setSelectedForecast] = useState<SpotForecast | null>(null);
  const [selectedForecastHour, setSelectedForecastHour] = useState<number | undefined>();
  const [coastFilter, setCoastFilter] = useState<CoastFilter>('all');
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const requestInFlight = useRef(false);
  const loginThenSave = useRef(false);
  const token = useRef(sessionStorage.getItem('surfCheckWriteToken'));

  const load = useCallback(
    async (force = false) => {
      if (requestInFlight.current) return;
      requestInFlight.current = true;
      try {
        if (!state.data) setStatus('Получаю данные…');
        const next = force ? await api.refresh() : await api.state();
        setState(next);
        setError(next.error ? `Ошибка: ${next.error}` : '');
        if (next.loading && !next.data) setStatus('Запрашиваю прогноз…');
        else if (next.loading) setStatus('Обновляю данные…');
        else if (next.updated) setStatus(`Обновлено: ${formatFull(next.updated)}`);
        else setStatus('Данных пока нет.');
      } catch (cause) {
        setError(
          `Не удалось получить состояние сервиса: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        setStatus('Ошибка backend-сервиса.');
      } finally {
        requestInFlight.current = false;
      }
    },
    [state.data],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!state.loading && !error) return;
    const delay = state.loading ? POLL_INTERVAL_MS : RETRY_INTERVAL_MS;
    const timer = window.setInterval(() => void load(), delay);
    return () => window.clearInterval(timer);
  }, [state.loading, error, load]);

  useEffect(() => {
    const savedToken = token.current;
    if (!savedToken) return;
    void api.authenticate(savedToken).then(
      () => setLoggedIn(true),
      (cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) {
          sessionStorage.removeItem('surfCheckWriteToken');
          token.current = null;
          setLoggedIn(false);
        }
      },
    );
  }, []);

  async function login(value: string) {
    await api.authenticate(value);
    sessionStorage.setItem('surfCheckWriteToken', value);
    token.current = value;
    setLoggedIn(true);
    setLoginOpen(false);
    if (loginThenSave.current) {
      loginThenSave.current = false;
      await saveEditorSpots(value);
    }
  }

  async function saveEditorSpots(authToken = token.current) {
    if (!authToken) {
      loginThenSave.current = true;
      setLoginOpen(true);
      return;
    }
    const validation = SpotsSchema.safeParse(editorSpots);
    if (!validation.success) {
      setEditorMessage(validation.error.issues[0]?.message ?? 'Проверьте введённые точки.');
      return;
    }
    setEditorBusy(true);
    setEditorMessage('');
    try {
      const result = await api.saveSpots(validation.data, authToken);
      setEditorSpots(result.spots);
      setEditorOpen(false);
      setState((current) => ({ ...current, loading: true }));
      setStatus('Сохранил точки, обновляю прогноз…');
      void load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        sessionStorage.removeItem('surfCheckWriteToken');
        token.current = null;
        setLoggedIn(false);
      }
      setEditorMessage(
        `Не удалось сохранить изменения: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setEditorBusy(false);
    }
  }

  function toggleLogin() {
    if (token.current) {
      sessionStorage.removeItem('surfCheckWriteToken');
      token.current = null;
      setLoggedIn(false);
      return;
    }
    loginThenSave.current = false;
    setLoginOpen(true);
  }

  async function openEditor(selectedId: string | null = null) {
    setEditorMessage('');
    setEditorSelectedId(selectedId);
    try {
      const spots = await api.spots();
      setEditorSpots(spots);
      setEditorOpen(true);
    } catch (cause) {
      setEditorMessage(
        `Не удалось открыть редактор: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      setEditorOpen(true);
    }
  }

  function editForecastSpot(spotId: string) {
    setSelectedForecast(null);
    setSelectedForecastHour(undefined);
    void openEditor(spotId);
  }

  function openForecast(spot: SpotForecast, hourTimestamp?: number) {
    setSelectedForecastHour(hourTimestamp);
    setSelectedForecast(spot);
  }

  function toggleCardView() {
    const next = !compact;
    setCompact(next);
    localStorage.setItem(CARD_VIEW_STORAGE_KEY, next ? 'compact' : 'detailed');
  }

  const spots = state.data?.spots ?? [];
  const visibleSpots = spots.filter((spot) => {
    if (coastFilter === 'available') return !spot.error && Boolean(spot.now);
    if (coastFilter === 'rideable') {
      return !spot.error && Boolean(spot.now && !spot.now.danger && spot.now.score >= 45);
    }
    if (coastFilter === 'dangerous') return !spot.error && Boolean(spot.now?.danger);
    return true;
  });
  const filterLabel: Record<CoastFilter, string> = {
    all: 'Все споты',
    available: 'С прогнозом',
    rideable: 'Можно рассмотреть для сессии',
    dangerous: 'Опасные условия',
  };

  return (
    <>
      <main className="wrap">
        <header className="header">
          <div>
            <div className="eyebrow">
              Калининградская область <span>·</span> Балтийское море
            </div>
            <h1>Kaliningrad Surf Check</h1>
            <div className="sub" role="status" aria-live="polite">
              <span className="live-dot" aria-hidden="true" />
              {status}
            </div>
          </div>
          <div className="header-actions">
            <button className="button secondary" type="button" onClick={toggleLogin}>
              <CoastIcon name="user" />
              {loggedIn ? 'Выйти' : 'Войти'}
            </button>
            <button className="button secondary" type="button" onClick={() => void openEditor()}>
              <CoastIcon name="map" />
              Точки на карте
            </button>
            <button
              className="button"
              type="button"
              disabled={state.loading}
              onClick={() => void load(true)}
            >
              <CoastIcon name="refresh" />
              {state.loading ? 'Обновление…' : 'Обновить'}
            </button>
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {state.data && (
          <Summary
            data={state.data}
            onOpenMethodology={() => setMethodologyOpen(true)}
            activeFilter={coastFilter}
            onFilterChange={setCoastFilter}
            onOpenForecast={openForecast}
          />
        )}
        <section aria-labelledby="spots-heading">
          <div className="section-heading-row">
            <div>
              <h2 className="section-heading" id="spots-heading">
                <CoastIcon name="wave" />
                Условия на спотах
              </h2>
              <p className="section-caption">
                {filterLabel[coastFilter]} · показано {visibleSpots.length} из {spots.length} ·{' '}
                обновление каждые 5 минут
                {coastFilter !== 'all' && (
                  <>
                    {' · '}
                    <button
                      className="score-help-link"
                      type="button"
                      onClick={() => setCoastFilter('all')}
                    >
                      Сбросить фильтр
                    </button>
                  </>
                )}
              </p>
            </div>
            <button
              className="button secondary view-toggle"
              type="button"
              aria-pressed={compact}
              onClick={toggleCardView}
            >
              {compact ? 'Подробный вид' : 'Компактный вид'}
            </button>
          </div>
          <div className={`grid${compact ? ' compact' : ''}`}>
            {visibleSpots.length ? (
              visibleSpots.map((spot) => (
                <SpotCard key={spot.id} spot={spot} onOpenForecast={openForecast} />
              ))
            ) : state.data?.spots.length ? (
              <div className="empty">
                Нет спотов, подходящих под фильтр «{filterLabel[coastFilter]}».
              </div>
            ) : state.loading ? (
              <div className="empty">Получаю данные прогноза…</div>
            ) : (
              <div className="empty">Нет данных.</div>
            )}
          </div>
        </section>
        <footer className="footer">
          {state.data && (
            <div className="footer-content">
              <span>
                Источник: {state.data.source}. Обновлено:{' '}
                {state.updated ? formatFull(state.updated) : '—'}. {state.data.disclaimer}
              </span>
              <span className="photo-credit">
                Иллюстративные фото:{' '}
                <a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer">
                  Unsplash
                </a>
              </span>
              <button
                className="score-help-link"
                type="button"
                onClick={() => setMethodologyOpen(true)}
              >
                Как рассчитывается оценка спота и часа?
              </button>
            </div>
          )}
        </footer>
      </main>
      <LoginDialog
        open={loginOpen}
        onClose={() => {
          loginThenSave.current = false;
          setLoginOpen(false);
        }}
        onLogin={login}
      />
      <SpotEditorDialog
        open={editorOpen}
        initialSelectedId={editorSelectedId}
        spots={editorSpots}
        onSpotsChange={setEditorSpots}
        onClose={() => setEditorOpen(false)}
        onSave={() => saveEditorSpots()}
        busy={editorBusy}
        message={editorMessage}
        setMessage={setEditorMessage}
      />
      <ForecastDialog
        spot={selectedForecast}
        initialHour={selectedForecastHour}
        onClose={() => {
          setSelectedForecast(null);
          setSelectedForecastHour(undefined);
        }}
        onEdit={
          loggedIn && selectedForecast ? () => editForecastSpot(selectedForecast.id) : undefined
        }
      />
      <ScoreMethodologyDialog
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
        spots={state.data?.spots ?? []}
      />
    </>
  );
}

export default App;

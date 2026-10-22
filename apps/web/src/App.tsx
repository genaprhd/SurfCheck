import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
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
const MAX_SPOTS = 40;

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Kaliningrad',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
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

interface EditorDialogProps {
  open: boolean;
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
      setSelectedId(null);
      setPlacing(false);
      setDirty(false);
    }
  }, [open]);

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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    }).addTo(map);
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
        offshore: [...(closest?.offshore ?? [90, 135, 180])],
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

  function updateSelected(patch: Partial<Pick<Spot, 'name' | 'lat' | 'lon'>>) {
    if (!selected) return;
    const next = spots.map((spot) => (spot.id === selected.id ? { ...spot, ...patch } : spot));
    onSpotsChange(next);
    setDirty(true);
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

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{display(value)}</div>
    </div>
  );
}

function Summary({ data }: { data: NonNullable<ForecastState['data']> }) {
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
  return (
    <section className="banner dashboard" aria-labelledby="dashboard-heading">
      <h2 className="dashboard-heading" id="dashboard-heading">
        Сводка по побережью
      </h2>
      <div className="dashboard-stats">
        <div className="dashboard-stat">
          <span>Доступно прогнозов</span>
          <strong>
            {available.length} / {spots.length}
          </strong>
        </div>
        <div className="dashboard-stat">
          <span>Можно рассмотреть для сессии</span>
          <strong>{rideable}</strong>
        </div>
        <div className="dashboard-stat">
          <span>Опасные условия</span>
          <strong>{dangerous}</strong>
        </div>
        <div className="dashboard-stat">
          <span>Средняя оценка</span>
          <strong>{average === null ? '—' : `${average}/100`}</strong>
        </div>
      </div>
      <div className="hero-grid">
        <div className="hero-item">
          <div className="hero-label">Лучший спот сейчас</div>
          <div className="hero-value">{bestNow?.spot ?? '—'}</div>
          <div className="hero-detail">
            {bestNow
              ? `${bestNow.verdict} · ${bestNow.score}/100 · волна ${display(bestNow.wave)} м · ветер ${display(bestNow.wind)} м/с`
              : 'Пока нет доступных данных'}
          </div>
        </div>
        <div className="hero-item">
          <div className="hero-label">Лучшее окно на 48 часов</div>
          <div className="hero-value">{bestNext?.spot ?? '—'}</div>
          <div className="hero-detail">
            {bestNext
              ? `${formatFull(bestNext.ts)} · ${bestNext.verdict} · ${bestNext.score}/100`
              : 'Подходящего прогноза пока нет'}
          </div>
        </div>
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

function ForecastDay({ label, hours }: { label: string; hours: HourForecast[] }) {
  if (!hours.length) return <div className="empty">Нет данных для этого дня.</div>;
  const bestScore = Math.max(...hours.map((hour) => hour.score));
  return (
    <>
      <div className="forecast-day-summary">
        <strong>{label}</strong>
        <span>
          {hours.length} ч · лучший прогноз {bestScore}/100
        </span>
      </div>
      <div className="forecast-chart" role="img" aria-label="Почасовой график оценки прогноза">
        {hours.map((hour) => (
          <div
            className={`forecast-bar ${barClass(hour.score)}`}
            style={{ height: `${Math.max(5, hour.score)}%` }}
            title={`${formatFull(hour.ts)} · ${hour.verdict} · ${hour.score}/100`}
            key={hour.ts}
          />
        ))}
      </div>
      <div className="forecast-chart-labels">
        <span>{formatTime(hours[0]!.ts)}</span>
        <span>{formatTime(hours.at(-1)!.ts)}</span>
      </div>
      <div className="forecast-hour-list">
        {hours.map((hour) => (
          <div className="forecast-hour" key={hour.ts}>
            <div className="forecast-hour-heading">
              <time>{formatTime(hour.ts)}</time>
              <strong className={`forecast-hour-score ${scoreClass(hour.score)}`}>
                {hour.score}
              </strong>
              <span className="forecast-hour-verdict">
                {hour.verdict}
                {hour.danger ? ' · Опасно' : ''}
              </span>
            </div>
            <div className="forecast-hour-metrics">
              <span>
                Волна <b>{display(hour.wave)} м</b>
              </span>
              <span>
                Период <b>{display(hour.period)} с</b>
              </span>
              <span>
                Ветер{' '}
                <b>
                  {display(hour.wind)} м/с {hour.windDir}
                </b>
              </span>
              <span>
                Порывы <b>{display(hour.gust)} м/с</b>
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ForecastDialog({ spot, onClose }: { spot: SpotForecast | null; onClose: () => void }) {
  const open = spot !== null;
  const { dialogRef, handleCancel, handleBackdrop } = useModal(open, onClose);
  const mapElement = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => dayGroups(spot?.hours ?? []), [spot]);
  const [selectedDay, setSelectedDay] = useState(0);

  useEffect(() => {
    setSelectedDay(0);
  }, [spot?.id]);

  useEffect(() => {
    if (!open || !spot || !mapElement.current) return;
    const map = L.map(mapElement.current, { zoomAnimation: false }).setView(
      [spot.lat, spot.lon],
      11,
    );
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    }).addTo(map);
    const marker = L.marker([spot.lat, spot.lon]).addTo(map);
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(timer);
      map.stop();
      map.removeLayer(marker);
      map.removeLayer(tiles);
      map.remove();
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
                <span>
                  <strong>{current?.verdict ?? '—'}</strong> · Волна {display(current?.wave)} м ·{' '}
                  ветер {display(current?.wind)} м/с {current?.windDir} · период{' '}
                  {display(current?.period)} с
                </span>
              </div>
            </div>
            <button className="editor-close" type="button" aria-label="Закрыть" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="forecast-dialog-content">
            <section className="forecast-map-section" aria-labelledby="forecast-map-heading">
              <div className="forecast-section-heading">
                <h3 id="forecast-map-heading">Точка на карте</h3>
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
              <h3 id="forecast-hours-heading">Прогноз на сегодня и следующие 3 дня</h3>
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
                    label={groups[selectedDay]?.label ?? ''}
                    hours={groups[selectedDay]?.hours ?? []}
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
}: {
  spot: SpotForecast;
  onOpenForecast: (spot: SpotForecast) => void;
}) {
  if (spot.error) {
    return (
      <article className="card forecast-card has-error">
        <div className="card-top">
          <div>
            <h2>{spot.name}</h2>
            <div className="note">{spot.note}</div>
            <a
              className="map-link"
              href={`https://www.openstreetmap.org/?mlat=${spot.lat}&mlon=${spot.lon}#map=13/${spot.lat}/${spot.lon}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Точка прогноза на карте ↗
            </a>
          </div>
          <div className="score bad">!</div>
        </div>
        <div className="verdict">Ошибка</div>
        <div className="reasons">
          <div className="reason">{spot.error}</div>
        </div>
      </article>
    );
  }

  const now = spot.now;
  const best = spot.best;
  const hours = (spot.hours ?? []).slice(0, 48);
  return (
    <article className={`card forecast-card${spot.error ? ' has-error' : ''}`}>
      <div className="card-top">
        <div>
          <h2>{spot.name}</h2>
          <div className="note">{spot.note}</div>
          <a
            className="map-link"
            href={`https://www.openstreetmap.org/?mlat=${spot.lat}&mlon=${spot.lon}#map=13/${spot.lat}/${spot.lon}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Точка прогноза на карте ↗
          </a>
        </div>
        <div className={`score ${scoreClass(now?.score ?? 0)}`}>{now?.score ?? 0}</div>
      </div>
      <button
        className="button secondary forecast-open"
        type="button"
        onClick={() => onOpenForecast(spot)}
      >
        Подробный прогноз
      </button>
      <div className="verdict">{now?.verdict ?? '—'}</div>
      <div className="compact-details">
        <span>
          Волна: <strong>{display(now?.wave)} м</strong>
        </span>
        <span>
          Ветер:{' '}
          <strong>
            {display(now?.wind)} м/с {now?.windDir}
          </strong>
        </span>
        <span>
          Период: <strong>{display(now?.period)} с</strong>
        </span>
      </div>
      {waveCompass(now?.waveDirDeg ?? null, now?.waveDir ?? '')}
      <div className="metrics">
        <Metric label="Волна" value={now?.wave === null ? null : `${now?.wave} м`} />
        <Metric label="Период" value={now?.period === null ? null : `${now?.period} с`} />
        <Metric
          label="Ветер"
          value={now?.wind === null ? null : `${now?.wind} м/с ${now?.windDir}`}
        />
        <Metric label="Порывы" value={now?.gust === null ? null : `${now?.gust} м/с`} />
        <Metric label="Вода" value={now?.sst === null ? null : `${now?.sst}°C`} />
        <Metric label="Уровень" value={now?.level} />
        <Metric label="Гидрокостюм" value={now?.gear} />
      </div>
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
    </article>
  );
}

function App() {
  const [state, setState] = useState(EMPTY_STATE);
  const [status, setStatus] = useState('Загружаю данные…');
  const [error, setError] = useState('');
  const [compact, setCompact] = useState(
    () => localStorage.getItem('surfCheckCardView') === 'compact',
  );
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorMessage, setEditorMessage] = useState('');
  const [editorSpots, setEditorSpots] = useState<Spot[]>([]);
  const [selectedForecast, setSelectedForecast] = useState<SpotForecast | null>(null);
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

  async function openEditor() {
    setEditorMessage('');
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

  function toggleCardView() {
    const next = !compact;
    setCompact(next);
    localStorage.setItem('surfCheckCardView', next ? 'compact' : 'detailed');
  }

  return (
    <>
      <main className="wrap">
        <header className="header">
          <div>
            <div className="eyebrow">Калининградская область · Балтийское море</div>
            <h1>Kaliningrad Surf Check</h1>
            <div className="sub" role="status" aria-live="polite">
              {status}
            </div>
          </div>
          <div className="header-actions">
            <button className="button secondary" type="button" onClick={toggleLogin}>
              {loggedIn ? 'Выйти' : 'Войти'}
            </button>
            <button className="button secondary" type="button" onClick={() => void openEditor()}>
              Точки на карте
            </button>
            <button
              className="button"
              type="button"
              disabled={state.loading}
              onClick={() => void load(true)}
            >
              {state.loading ? 'Обновление…' : 'Обновить'}
            </button>
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {state.data && <Summary data={state.data} />}
        <section aria-labelledby="spots-heading">
          <div className="section-heading-row">
            <div>
              <h2 className="section-heading" id="spots-heading">
                Условия на спотах
              </h2>
              <p className="section-caption">
                Точки прогноза по районам побережья · обновление каждые 5 минут
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
            {state.data?.spots.length ? (
              state.data.spots.map((spot) => (
                <SpotCard key={spot.id} spot={spot} onOpenForecast={setSelectedForecast} />
              ))
            ) : state.loading ? (
              <div className="empty">Получаю данные прогноза…</div>
            ) : (
              <div className="empty">Нет данных.</div>
            )}
          </div>
        </section>
        <footer className="footer">
          {state.data && (
            <>
              Источник: {state.data.source}. Обновлено:{' '}
              {state.updated ? formatFull(state.updated) : '—'}. {state.data.disclaimer}
            </>
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
        spots={editorSpots}
        onSpotsChange={setEditorSpots}
        onClose={() => setEditorOpen(false)}
        onSave={() => saveEditorSpots()}
        busy={editorBusy}
        message={editorMessage}
        setMessage={setEditorMessage}
      />
      <ForecastDialog spot={selectedForecast} onClose={() => setSelectedForecast(null)} />
    </>
  );
}

export default App;

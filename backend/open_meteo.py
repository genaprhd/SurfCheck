import json
import ssl
import time
import urllib.error
import urllib.request

from .scoring import evaluate_hour

_SSL_CONTEXT = None

def get_ssl_context():
    global _SSL_CONTEXT

    if _SSL_CONTEXT is None:
        context = ssl.create_default_context()
        if not context.get_ca_certs():
            try:
                import certifi
            except ImportError as exc:
                raise RuntimeError(
                    "В Python не найдены доверенные сертификаты. "
                    "Установите пакет certifi: python3 -m pip install certifi"
                ) from exc
            context.load_verify_locations(cafile=certifi.where())
        _SSL_CONTEXT = context

    return _SSL_CONTEXT

def fetch_json(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "KaliningradSurfCheck/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=25, context=get_ssl_context()) as r:
        return json.loads(r.read().decode("utf-8"))

def fetch_marine(lat, lon):
    base = "https://marine-api.open-meteo.com/v1/marine"

    full_vars = ",".join(
        [
            "wave_height",
            "wave_period",
            "wave_direction",
            "swell_wave_height",
            "swell_wave_period",
            "swell_wave_direction",
            "wind_wave_height",
            "wind_wave_period",
            "wind_wave_direction",
            "sea_surface_temperature",
        ]
    )

    minimal_vars = "wave_height,wave_period,wave_direction"

    common = (
        f"?latitude={lat}"
        f"&longitude={lon}"
        f"&timeformat=unixtime"
        f"&timezone=Europe/Kaliningrad"
        f"&forecast_days=3"
    )

    try:
        return fetch_json(base + common + f"&hourly={full_vars}")
    except urllib.error.HTTPError as exc:
        if exc.code != 400:
            raise
        # Если API отклонил полный набор параметров, запрашиваем базовые данные.
        return fetch_json(base + common + f"&hourly={minimal_vars}")

def fetch_weather(lat, lon):
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}"
        f"&longitude={lon}"
        "&hourly="
        "wind_speed_10m,"
        "wind_gusts_10m,"
        "wind_direction_10m,"
        "temperature_2m,"
        "precipitation_probability,"
        "weather_code"
        "&wind_speed_unit=ms"
        "&timeformat=unixtime"
        "&timezone=Europe/Kaliningrad"
        "&forecast_days=3"
    )
    return fetch_json(url)

def fetch_spot(spot):
    marine = fetch_marine(spot["lat"], spot["lon"])
    weather = fetch_weather(spot["lat"], spot["lon"])

    marine_hourly = marine.get("hourly", {})
    weather_hourly = weather.get("hourly", {})

    times = marine_hourly.get("time", []) or []
    if not times:
        raise RuntimeError("Пустой ответ от marine API")

    weather_times = weather_hourly.get("time", []) or []
    weather_map = {t: i for i, t in enumerate(weather_times)}

    now = int(time.time())

    start = 0
    found = False

    for i, t in enumerate(times):
        if t >= now - 1800:
            start = i
            found = True
            break

    if not found:
        start = max(0, len(times) - 1)

    end = min(len(times), start + 49)

    hours = []
    best = None
    now_eval = None

    for i in range(start, end):
        ts = times[i]

        wi = weather_map.get(ts, i if i < len(weather_times) else 0)

        ev = evaluate_hour(
            spot=spot,
            marine_hourly=marine_hourly,
            weather_hourly=weather_hourly,
            mi=i,
            wi=wi,
            ts=ts,
        )

        if now_eval is None:
            now_eval = ev

        hours.append(ev)

        if not ev["danger"]:
            if (
                best is None
                or ev["score"] > best["score"]
                or (ev["score"] == best["score"] and ev["ts"] < best["ts"])
            ):
                best = ev

    if best is None and hours:
        best = max(hours, key=lambda x: x["score"])

    if now_eval is None:
        raise RuntimeError("Не удалось рассчитать текущий чек")

    return {
        "id": spot["id"],
        "name": spot["name"],
        "note": spot["note"],
        "lat": spot["lat"],
        "lon": spot["lon"],
        "now": now_eval,
        "best": best,
        "hours": hours,
    }

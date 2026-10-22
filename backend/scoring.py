import datetime

from .config import DIR_SCORE_PTS, HEIGHT_PTS, MONTH_WATER, PERIOD_PTS, WIND_BASE_PTS
from .utils import (
    as_int,
    best_diff,
    clean,
    clamp,
    compass,
    interp,
    round1,
    wave_direction_diff,
)

def choose_wave(h, p, d, sh, sp, sd, wh, wp, wd):
    """
    Если нет общего волнения, собираем его из swell / wind wave.
    """
    h = clean(h)
    p = clean(p)
    d = clean(d)

    sh = clean(sh)
    sp = clean(sp)
    sd = clean(sd)

    wh = clean(wh)
    wp = clean(wp)
    wd = clean(wd)

    if h is None:
        if (sh or 0) >= (wh or 0):
            h, p, d = sh, sp, sd
        else:
            h, p, d = wh, wp, wd

    if p is None:
        if (sh or 0) >= (wh or 0):
            p = sp
        else:
            p = wp

    if d is None:
        if (sh or 0) >= (wh or 0):
            d = sd
        else:
            d = wd

    return h, p, d

def direction_score(deg, targets):
    diff = wave_direction_diff(deg, targets)
    if diff is None:
        return 50.0
    return interp(diff, DIR_SCORE_PTS)

def wind_score(ws, wg, wdir, offshore_dirs):
    if ws is None:
        base = 70.0
    else:
        base = interp(ws, WIND_BASE_PTS)

    wdir = clean(wdir)

    if wdir is None or not offshore_dirs:
        return base

    off = best_diff(wdir, offshore_dirs)

    on_targets = [(d + 180.0) % 360.0 for d in offshore_dirs]
    on = best_diff(wdir, on_targets)

    adj = 0.0

    if off is not None and off <= 65.0:
        adj += (1.0 - off / 65.0) * 12.0

    if on is not None and on <= 65.0:
        adj -= (1.0 - on / 65.0) * 35.0

    if wg is not None and ws is not None and wg > ws + 5.0:
        adj -= 8.0

    if wg is not None and wg > 18.0:
        adj -= 12.0

    return clamp(base + adj)

def safety_flags(h, ws, wg, code):
    dangers = []

    if ws is not None and ws >= 15:
        dangers.append("Очень сильный ветер")

    if wg is not None and wg >= 22:
        dangers.append("Опасные порывы ветра")

    if h is not None and h >= 3.5:
        dangers.append("Экстремальная высота волн")

    if code is not None and code in (95, 96, 99):
        dangers.append("Гроза: сессию лучше отменить")

    return (len(dangers) > 0), dangers

def build_reasons(h, p, d, ws, wg, wdir, precip, code, dangers, spot):
    reasons = []

    if h is None:
        reasons.append("Нет данных о волнении.")
    else:
        if h < 0.25:
            reasons.append("Волн почти нет: чек слабый.")
        elif h < 0.6:
            reasons.append("Небольшая высота: подходит для лонгборда и обучения.")
        elif h <= 1.8:
            reasons.append("Рабочая высота для Балтики.")
        else:
            reasons.append("Большая высота: нужен опыт и осмотр спота.")

    if p is not None:
        if p < 3.5:
            reasons.append("Короткий период: вероятен чоп и рваная поверхность.")
        elif 5.5 <= p <= 8.5:
            reasons.append("Хороший период для Балтийского моря.")
        elif p > 10:
            reasons.append("Длинный период: возможна редкая, но мощная энергия.")

    diff = wave_direction_diff(d, spot.get("bestFrom", []))
    if diff is not None:
        if diff <= 35:
            reasons.append("Волны приходят с рабочего направления.")
        elif diff <= 70:
            reasons.append("Направление боковое, качество сильно зависит от ветра.")
        else:
            reasons.append("Направление не совпадает с лучшим окном для спота.")

    wdir = clean(wdir)
    if wdir is not None:
        offshore_dirs = spot.get("offshore", [])
        off = best_diff(wdir, offshore_dirs)
        on = best_diff(wdir, [(x + 180.0) % 360.0 for x in offshore_dirs])

        if off is not None and off <= 50:
            reasons.append("Ветер оффшорный: поверхность чище.")
        elif on is not None and on <= 50:
            reasons.append("Ветер оншорный: волны могут быть разбитыми.")

    if ws is not None and ws > 10:
        reasons.append("Сильный ветер: сложнее с контролем и греблей.")

    if precip is not None and precip >= 65:
        reasons.append("Высокая вероятность осадков.")

    if code is not None and code in (95, 96, 99):
        reasons.append("Возможна гроза: лучше не выходить на воду.")

    for dgr in dangers:
        if dgr not in reasons:
            reasons.append(dgr)

    return reasons[:6]

def verdict(score, danger):
    if danger:
        return "Опасно"

    if score >= 75:
        return "Отлично"

    if score >= 60:
        return "Хорошо"

    if score >= 45:
        return "Можно"

    if score >= 25:
        return "Слабо"

    return "Нет"

def gear_advice(sst, ts):
    temp = clean(sst)

    if temp is None:
        try:
            month = datetime.datetime.fromtimestamp(int(ts), datetime.timezone.utc).month
        except Exception:
            month = 1

        temp = MONTH_WATER.get(month, 12)

    if temp < 5:
        return "6/5 мм + ботинки, перчатки, капюшон"

    if temp < 10:
        return "5/4 мм + ботинки"

    if temp < 15:
        return "4/3 мм"

    if temp < 19:
        return "3/2 мм"

    return "2 мм / спринг"

def level_advice(h, ws):
    h = clean(h)
    ws = clean(ws)

    if h is None:
        return "—"

    if ws is not None and ws > 12:
        return "Опытные / не рекомендуется"

    if h < 0.45:
        return "Лонгборд / новички при чистом ветре"

    if h < 1.0:
        return "Начинающие и лонгборд"

    if h < 1.8:
        return "Средний уровень"

    return "Опытные"

def evaluate_hour(spot, marine_hourly, weather_hourly, mi, wi, ts):
    def mget(key):
        arr = marine_hourly.get(key) or []
        if mi < len(arr):
            return arr[mi]
        return None

    def wget(key):
        arr = weather_hourly.get(key) or []
        if wi < len(arr):
            return arr[wi]
        return None

    h = clean(mget("wave_height"))
    p = clean(mget("wave_period"))
    d = clean(mget("wave_direction"))

    sh = clean(mget("swell_wave_height"))
    sp = clean(mget("swell_wave_period"))
    sd = clean(mget("swell_wave_direction"))

    wh = clean(mget("wind_wave_height"))
    wp = clean(mget("wind_wave_period"))
    wd = clean(mget("wind_wave_direction"))

    h, p, d = choose_wave(h, p, d, sh, sp, sd, wh, wp, wd)

    ws = clean(wget("wind_speed_10m"))
    wg = clean(wget("wind_gusts_10m"))
    wdir = clean(wget("wind_direction_10m"))
    precip = clean(wget("precipitation_probability"))
    code = as_int(wget("weather_code"))

    sst = clean(mget("sea_surface_temperature"))

    height_score = interp(h, HEIGHT_PTS)
    period_score = interp(p, PERIOD_PTS)
    direction_score_value = direction_score(d, spot.get("bestFrom", []))
    wind_score_value = wind_score(ws, wg, wdir, spot.get("offshore", []))

    # Итоговый скор:
    # 40% — высота волны,
    # 22% — период,
    # 20% — направление волны,
    # 18% — ветер.
    overall = (
        0.40 * height_score
        + 0.22 * period_score
        + 0.20 * direction_score_value
        + 0.18 * wind_score_value
    )

    if h is None:
        overall = min(overall, 15.0)

    if h is not None and h < 0.25:
        overall = min(overall, 8.0)

    danger, dangers = safety_flags(h, ws, wg, code)

    if danger:
        overall = min(overall, 12.0)

    score_int = int(round(clamp(overall)))

    reasons = build_reasons(
        h=h,
        p=p,
        d=d,
        ws=ws,
        wg=wg,
        wdir=wdir,
        precip=precip,
        code=code,
        dangers=dangers,
        spot=spot,
    )

    return {
        "ts": ts,
        "score": score_int,
        "verdict": verdict(score_int, danger),
        "wave": round1(h),
        "period": round1(p),
        "waveDir": compass(d),
        "waveDirDeg": round1(d),
        "wind": round1(ws),
        "gust": round1(wg),
        "windDir": compass(wdir),
        "sst": round1(sst),
        "reasons": reasons,
        "dangers": dangers,
        "gear": gear_advice(sst, ts),
        "level": level_advice(h, ws),
        "danger": danger,
    }

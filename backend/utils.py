import math

def clean(x):
    """Возвращает float или None, если значение пустое/битое."""
    try:
        x = float(x)
        if math.isfinite(x):
            return x
        return None
    except Exception:
        return None

def clamp(x, lo=0.0, hi=100.0):
    x = clean(x)
    if x is None:
        return 0.0
    return max(lo, min(hi, x))

def interp(x, pts):
    """Линейная интерполяция по опорным точкам."""
    x = clean(x)
    if x is None:
        return 0.0

    if x <= pts[0][0]:
        return pts[0][1]

    if x >= pts[-1][0]:
        return pts[-1][1]

    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        if x <= x2:
            if x2 == x1:
                return y2
            return y1 + (y2 - y1) * (x - x1) / (x2 - x1)

    return pts[-1][1]

def angle_diff(a, b):
    a = clean(a)
    b = clean(b)
    if a is None or b is None:
        return 180.0
    return abs((a - b + 180.0) % 360.0 - 180.0)

def best_diff(deg, targets):
    if deg is None or not targets:
        return None
    return min(angle_diff(deg, t) for t in targets)

def wave_direction_diff(deg, targets):
    """
    Устойчиво проверяет направление волны.

    Некоторые источники отдают направление 'откуда',
    некоторые — 'куда'. Поэтому проверяем и сам градус,
    и противоположный.
    """
    deg = clean(deg)
    if deg is None or not targets:
        return None

    d1 = best_diff(deg, targets)
    d2 = best_diff((deg + 180.0) % 360.0, targets)

    vals = [d for d in (d1, d2) if d is not None]
    if not vals:
        return None

    return min(vals)

def compass(deg):
    deg = clean(deg)
    if deg is None:
        return "—"

    dirs = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"]
    return dirs[int((deg + 22.5) // 45) % 8]

def round1(x):
    x = clean(x)
    if x is None:
        return None
    return round(x, 1)

def as_int(x):
    x = clean(x)
    if x is None:
        return None
    return int(x)

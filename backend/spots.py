import json
import os
import re
import threading

from . import config
from .utils import clean

SPOTS_LOCK = threading.RLock()


def normalize_spots(raw_spots):
    if not isinstance(raw_spots, list) or not raw_spots:
        raise ValueError("Список точек не должен быть пустым.")
    if len(raw_spots) > config.MAX_SPOTS:
        raise ValueError(f"Можно сохранить не более {config.MAX_SPOTS} точек.")

    normalized = []
    seen_ids = set()

    for index, raw in enumerate(raw_spots, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"Точка №{index} должна быть объектом.")

        spot_id = raw.get("id")
        if not isinstance(spot_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", spot_id):
            raise ValueError(f"Некорректный идентификатор точки №{index}.")
        if spot_id in seen_ids:
            raise ValueError(f"Идентификатор точки «{spot_id}» повторяется.")
        seen_ids.add(spot_id)

        name = raw.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            raise ValueError(f"Название точки №{index} должно быть длиной от 1 до 80 символов.")

        note = raw.get("note", "")
        if not isinstance(note, str) or len(note) > 160:
            raise ValueError(f"Описание точки №{index} должно быть не длиннее 160 символов.")

        lat = raw.get("lat")
        lon = raw.get("lon")
        if isinstance(lat, bool) or isinstance(lon, bool):
            raise ValueError(f"Координаты точки №{index} должны быть числами.")
        lat = clean(lat)
        lon = clean(lon)
        if lat is None or not -90 <= lat <= 90:
            raise ValueError(f"Широта точки №{index} должна быть от -90 до 90.")
        if lon is None or not -180 <= lon <= 180:
            raise ValueError(f"Долгота точки №{index} должна быть от -180 до 180.")

        directions = {}
        for key in ("bestFrom", "offshore"):
            values = raw.get(key)
            if not isinstance(values, list) or not values:
                raise ValueError(f"Для точки №{index} отсутствуют направления «{key}».")
            cleaned = [clean(value) for value in values]
            if any(value is None or not 0 <= value <= 360 for value in cleaned):
                raise ValueError(f"Направления «{key}» точки №{index} должны быть от 0 до 360.")
            directions[key] = cleaned

        normalized.append({
            "id": spot_id,
            "name": name.strip(),
            "note": note.strip(),
            "lat": lat,
            "lon": lon,
            "bestFrom": directions["bestFrom"],
            "offshore": directions["offshore"],
        })

    return normalized


def get_spots():
    with SPOTS_LOCK:
        return [dict(spot) for spot in config.SPOTS]


def load_saved_spots():
    if not config.SPOTS_FILE.exists():
        return

    with config.SPOTS_FILE.open(encoding="utf-8") as spots_file:
        saved_spots = json.load(spots_file)
    normalized = normalize_spots(saved_spots)

    with SPOTS_LOCK:
        config.SPOTS = normalized


def save_spots(raw_spots):
    normalized = normalize_spots(raw_spots)
    temporary_file = config.SPOTS_FILE.with_suffix(config.SPOTS_FILE.suffix + ".tmp")

    config.SPOTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SPOTS_LOCK:
        with temporary_file.open("w", encoding="utf-8") as spots_file:
            json.dump(normalized, spots_file, ensure_ascii=False, indent=2)
            spots_file.write("\n")
            spots_file.flush()
            os.fsync(spots_file.fileno())
        os.replace(temporary_file, config.SPOTS_FILE)
        config.SPOTS = normalized

    return get_spots()

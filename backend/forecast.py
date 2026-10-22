import concurrent.futures
import threading
import time

from .open_meteo import fetch_spot
from .spots import get_spots

STATE = {
    "data": None,
    "updated": 0,
    "loading": False,
    "error": None,
}
LOCK = threading.Lock()

def refresh(already_loading=False):
    if not already_loading:
        with LOCK:
            if STATE["loading"]:
                return

            STATE["loading"] = True
            STATE["error"] = None

    try:
        results = {}
        spots_config = get_spots()

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(spots_config))) as ex:
            futures = {ex.submit(fetch_spot, spot): spot for spot in spots_config}

            for future in concurrent.futures.as_completed(futures):
                spot = futures[future]

                try:
                    results[spot["id"]] = future.result()
                except Exception as exc:
                    results[spot["id"]] = {
                        "id": spot["id"],
                        "name": spot["name"],
                        "note": spot.get("note", ""),
                        "lat": spot["lat"],
                        "lon": spot["lon"],
                        "error": str(exc),
                    }

        order = {spot["id"]: i for i, spot in enumerate(spots_config)}
        spots = sorted(results.values(), key=lambda x: order.get(x.get("id"), 999))

        valid = [s for s in spots if "error" not in s and s.get("now")]

        best_now = None

        if valid:
            best_spot = max(valid, key=lambda s: s["now"]["score"])
            best_now = {"spot": best_spot["name"]}
            best_now.update(best_spot["now"])

        candidates = []

        for s in valid:
            if s.get("best"):
                item = {"spot": s["name"]}
                item.update(s["best"])
                candidates.append(item)

        best_next = None
        if candidates:
            best_next = max(candidates, key=lambda x: x["score"])

        STATE["data"] = {
            "spots": spots,
            "summary": {
                "best_now": best_now,
                "best_next": best_next,
            },
            "source": "Open-Meteo Marine + Forecast",
            "timezone": "Europe/Kaliningrad",
            "disclaimer": (
                "Это модельный прогноз для районов побережья, а не проверенные названия серф-брейков. "
                "Перед выходом сверяйте условия на месте, ветер, течение и безопасность."
            ),
        }

        STATE["updated"] = int(time.time())

    except Exception as exc:
        STATE["error"] = str(exc)

    finally:
        STATE["loading"] = False

def start_refresh():
    with LOCK:
        if STATE["loading"]:
            timer = threading.Timer(2, start_refresh)
            timer.daemon = True
            timer.start()
            return False

        STATE["loading"] = True
        STATE["error"] = None

    threading.Thread(
        target=refresh,
        kwargs={"already_loading": True},
        daemon=True,
    ).start()
    return True

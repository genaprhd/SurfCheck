import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend import config
from backend.server import Handler, Server
from backend.scoring import evaluate_hour, gear_advice, interp, wave_direction_diff
from backend.spots import normalize_spots, save_spots


class SpotValidationTests(unittest.TestCase):
    def test_default_spots_are_valid(self):
        self.assertEqual(len(normalize_spots(config.SPOTS)), 6)

    def test_duplicate_ids_are_rejected(self):
        spots = normalize_spots(config.SPOTS)
        spots[1]["id"] = spots[0]["id"]

        with self.assertRaisesRegex(ValueError, "повторяется"):
            normalize_spots(spots)

    def test_invalid_coordinates_are_rejected(self):
        spots = normalize_spots(config.SPOTS)
        spots[0]["lat"] = 91

        with self.assertRaisesRegex(ValueError, "Широта"):
            normalize_spots(spots)

    def test_saved_spots_are_written_to_configured_path(self):
        original_spots = config.SPOTS
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "nested" / "spots.json"
                with patch.object(config, "SPOTS_FILE", path):
                    saved = save_spots(config.SPOTS)
                    self.assertTrue(path.exists())
                    self.assertEqual(len(saved), 6)
        finally:
            config.SPOTS = original_spots


class ForecastScoringTests(unittest.TestCase):
    def test_interpolation_clamps_to_curve_bounds(self):
        self.assertEqual(interp(-1, [(0, 10), (1, 20)]), 10)
        self.assertEqual(interp(2, [(0, 10), (1, 20)]), 20)

    def test_wave_direction_accepts_opposite_bearing(self):
        self.assertEqual(wave_direction_diff(90, [270]), 0)

    def test_gear_advice_uses_monthly_water_fallback(self):
        self.assertEqual(gear_advice(None, 0), "6/5 мм + ботинки, перчатки, капюшон")

    def test_hour_evaluation_returns_frontend_forecast_fields(self):
        marine = {
            "wave_height": [0.6],
            "wave_period": [6],
            "wave_direction": [300],
            "swell_wave_height": [0.5],
            "swell_wave_period": [6],
            "swell_wave_direction": [300],
            "wind_wave_height": [0.3],
            "wind_wave_period": [4],
            "wind_wave_direction": [300],
            "sea_surface_temperature": [12],
        }
        weather = {
            "wind_speed_10m": [3],
            "wind_gusts_10m": [4],
            "wind_direction_10m": [180],
            "precipitation_probability": [0],
            "weather_code": [0],
        }

        result = evaluate_hour(config.SPOTS[0], marine, weather, 0, 0, 0)

        self.assertIn("score", result)
        self.assertIn("waveDirDeg", result)
        self.assertIn("gear", result)


class BackendApiTests(unittest.TestCase):
    def setUp(self):
        self.original_spots = config.SPOTS
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.spots_path = Path(self.temporary_directory.name) / "spots.json"
        self.spots_path_patch = patch.object(config, "SPOTS_FILE", self.spots_path)
        self.spots_path_patch.start()
        self.environment_patch = patch.dict(os.environ, {
            "CORS_ORIGINS": "https://surf.example",
            "SURF_CHECK_WRITE_TOKEN": "test-write-token",
        })
        self.environment_patch.start()
        self.refresh_patch = patch("backend.server.start_refresh")
        self.refresh_patch.start()

        self.server = Server(("127.0.0.1", 0), Handler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        self.refresh_patch.stop()
        self.environment_patch.stop()
        self.spots_path_patch.stop()
        config.SPOTS = self.original_spots
        self.temporary_directory.cleanup()

    def test_health_endpoint_and_allowed_cors_origin(self):
        request = Request(
            f"{self.base_url}/healthz",
            headers={"Origin": "https://surf.example"},
        )
        with urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://surf.example")
            self.assertEqual(json.load(response), {"status": "ok"})

    def test_spot_writes_require_the_configured_token(self):
        payload = json.dumps({"spots": config.SPOTS}).encode("utf-8")
        request = Request(
            f"{self.base_url}/api/spots",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as error:
            urlopen(request, timeout=2)
        self.assertEqual(error.exception.code, 401)
        self.assertFalse(self.spots_path.exists())

        authorized = Request(
            f"{self.base_url}/api/spots",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer test-write-token",
            },
            method="POST",
        )
        with urlopen(authorized, timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertTrue(self.spots_path.exists())


if __name__ == "__main__":
    unittest.main()

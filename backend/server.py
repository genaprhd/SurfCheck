import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from . import config
from .forecast import STATE, start_refresh
from .spots import get_spots, save_spots


def configured_origins():
    value = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500",
    )
    return {origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()}


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin and origin.rstrip("/") in configured_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Vary", "Origin")
        super().end_headers()

    def _send(self, code, content_type, body):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, "application/json; charset=utf-8", body)

    def _state_payload(self):
        return {
            "loading": STATE["loading"],
            "updated": STATE["updated"],
            "error": STATE["error"],
            "data": STATE["data"],
        }

    def do_OPTIONS(self):
        path = urlparse(self.path).path
        origin = self.headers.get("Origin", "").rstrip("/")
        if path != "/api/spots" or origin not in configured_origins():
            self._send_json(403, {"error": "Origin is not allowed."})
            return
        self._send(204, "text/plain; charset=utf-8", b"")

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/healthz":
            self._send_json(200, {"status": "ok"})
        elif path == "/api/state":
            self._send_json(200, self._state_payload())
        elif path == "/api/spots":
            self._send_json(200, {"spots": get_spots()})
        elif path == "/api/refresh":
            start_refresh()
            self._send_json(200, self._state_payload())
        elif path == "/favicon.ico":
            self._send(204, "text/plain; charset=utf-8", b"")
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/spots":
            self._send_json(404, {"error": "Not found"})
            return

        expected_token = os.environ.get("SURF_CHECK_WRITE_TOKEN", "")
        if not expected_token:
            self._send_json(503, {"error": "Запись отключена: на backend не настроен токен."})
            return

        authorization = self.headers.get("Authorization", "")
        supplied_token = authorization.removeprefix("Bearer ").strip()
        if not hmac.compare_digest(
            supplied_token.encode("utf-8"),
            expected_token.encode("utf-8"),
        ):
            self._send_json(401, {"error": "Неверный токен доступа."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 65536:
                raise ValueError("Размер запроса должен быть от 1 до 65536 байт.")
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Ожидался объект со списком точек.")
            spots = save_spots(payload.get("spots"))
        except (ValueError, UnicodeDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except OSError as exc:
            self._send_json(500, {"error": f"Не удалось сохранить точки: {exc}"})
            return

        start_refresh()
        self._send_json(200, {"spots": spots, "loading": True})

    def log_message(self, format, *args):
        pass


def create_server():
    return Server((config.HOST, config.PORT), Handler)

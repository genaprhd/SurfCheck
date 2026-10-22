import json

from . import config
from .forecast import start_refresh
from .server import create_server
from .spots import load_saved_spots


def main():
    try:
        load_saved_spots()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Не удалось загрузить {config.SPOTS_FILE}: {exc}") from exc

    server = create_server()
    print(f"Surf Check API listening on {config.HOST}:{config.PORT}")
    start_refresh()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

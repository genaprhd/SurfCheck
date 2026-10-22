# Kaliningrad Surf Check

Приложение разделено на статический интерфейс и Python API:

- `frontend/` — страница прогноза, редактор карты, стили и конфигурация URL API. Размещается на GitHub Pages.
- `backend/` — запросы Open-Meteo, расчёт оценок и REST API. Размещается как отдельный web service на Render.
- `tests/` — проверки валидации точек и расчёта прогноза.

GitHub Pages не запускает Python-код. Для работы обновления прогноза и редактора нужен доступный backend.

## Локальный запуск

В первом терминале из корня проекта:

```sh
python3 -m backend.main
```

Во втором терминале:

```sh
python3 -m http.server 5500 --directory frontend
```

Откройте <http://127.0.0.1:5500>. Для локального фронтенда API по умолчанию указывает на `http://127.0.0.1:8777`.

Чтобы разрешить сохранение точек локально, задайте один и тот же секрет только в окружении backend и вводите его в диалоге сохранения:

```sh
SURF_CHECK_WRITE_TOKEN='replace-with-a-long-random-token' python3 -m backend.main
```

Данные точек локально сохраняются в `surf_check_spots.json` рядом с корнем проекта. Путь можно переопределить переменной `SURF_CHECK_SPOTS_FILE`.

## Проверки

```sh
python3 -m unittest discover -s tests -v
python3 -m compileall backend
```

## Размещение backend на Render

1. Создайте GitHub-репозиторий из этой папки и отправьте ветку `main`.
2. В Render создайте Blueprint из репозитория и примените `render.yaml`.
3. Для `CORS_ORIGINS` укажите origin GitHub Pages, например `https://USERNAME.github.io` — без пути `/SurfCheck`.
4. Render сгенерирует `SURF_CHECK_WRITE_TOKEN`. Храните его только в настройках Render; не добавляйте секрет в репозиторий или GitHub Pages.
5. Дождитесь deploy и проверьте `https://<backend-host>/healthz`.
6. Чтобы перенести уже сохранённые точки из локального `surf_check_spots.json`, задайте в терминале `SURF_CHECK_API_URL` и `SURF_CHECK_WRITE_TOKEN` значениями из Render и отправьте файл:

   ```sh
   curl --fail-with-body -X POST \
     -H "Authorization: Bearer $SURF_CHECK_WRITE_TOKEN" \
     -H "Content-Type: application/json" \
     --data-binary @surf_check_spots.json \
     "$SURF_CHECK_API_URL/api/spots"
   ```

   Локальный файл с точками намеренно исключён из Git, поэтому он не публикуется вместе с исходниками.

Blueprint подключает постоянный диск в `/var/data`, чтобы пользовательские точки переживали перезапуск backend. Render может взимать плату за web service с постоянным диском; проверьте актуальные тарифы до создания ресурсов.

## Размещение frontend на GitHub Pages

1. В настройках репозитория добавьте Actions variable `SURF_CHECK_API_URL` с HTTPS URL backend, например `https://<backend-host>`.
2. В **Settings → Pages → Build and deployment** выберите **GitHub Actions**.
3. Запустите workflow **Deploy frontend to GitHub Pages** либо отправьте изменения в `main`.

Workflow собирает только `frontend/` и записывает URL API в `config.js` на этапе deploy. Секрет записи точек в эту сборку не попадает. Для сохранения изменений интерфейс попросит токен, который Render хранит на backend; вводится он только в браузере и остаётся в `sessionStorage` текущей вкладки.

## API

- `GET /healthz` — проверка готовности backend.
- `GET /api/state` — прогноз и состояние фонового обновления.
- `GET /api/refresh` — запустить обновление прогноза.
- `GET /api/spots` — текущий список точек.
- `POST /api/spots` — проверить и сохранить список точек; требуется `Authorization: Bearer <SURF_CHECK_WRITE_TOKEN>`.

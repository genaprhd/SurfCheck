# Kaliningrad Surf Check

Приложение прогноза для серф-спотов Калининградской области. Код организован как TypeScript monorepo:

- `apps/web/` — React 19, TypeScript, Vite и Leaflet; статический сайт публикуется на GitHub Pages.
- `apps/api/` — Node.js 22, TypeScript и Fastify 5; API размещается на Render.
- `packages/shared/` — общие типы и схемы валидации Zod.
- `tests-ts/` — unit- и API-тесты на Vitest.

Прогноз строится по Open-Meteo Marine и Forecast. Расчёт оценки, проверка опасных условий, редактор точек, вход администратора, компактный/подробный вид карточек, сводная панель и карта с почасовым прогнозом на сегодня и следующие три дня сохранены.

## Локальный запуск

Нужен Node.js 22 или новее и Corepack:

```sh
corepack pnpm install
export SURF_CHECK_WRITE_TOKEN="$(openssl rand -hex 32)"
corepack pnpm dev
```

Откройте <http://localhost:5173>. Команда `dev` поднимает Vite и API одновременно. В dev-режиме Vite проксирует `/api` на `http://localhost:8777`.

Токен задаётся только в окружении backend. Войдите в админку через кнопку **Войти**; токен хранится в `sessionStorage` вкладки до её закрытия или выхода. Если токен не настроен, просмотр прогноза работает, но запись точек отключена.

Точки читаются из `surf_check_spots.json` в корне репозитория. Этот пользовательский файл исключён из Git. Для другого пути укажите `SURF_CHECK_SPOTS_FILE`.

## Разработка и проверки

```sh
corepack pnpm check
```

Команда запускает ESLint, проверку форматирования Prettier, TypeScript typecheck, Vitest и production-сборки API и интерфейса. Отдельно доступны `corepack pnpm dev`, `corepack pnpm test` и `corepack pnpm build`.

## Деплой

### API на Render

1. Создайте Blueprint из репозитория и примените `render.yaml`.
2. Render создаст `SURF_CHECK_WRITE_TOKEN`; храните его только в настройках сервиса.
3. Добавьте `CORS_ORIGINS` со значением origin GitHub Pages, например `https://USERNAME.github.io` — без пути репозитория.
4. Создайте для сервиса Render Deploy Hook. Сохраните его URL в GitHub Actions secret `RENDER_DEPLOY_HOOK_URL`.
5. Постоянный диск смонтирован в `/var/data`; пользовательские точки сохраняются в `/var/data/surf_check_spots.json`.

CI сначала проверяет сборку. После успешной проверки GitHub Pages публикует фронтенд, а workflow запускает Render Deploy Hook. Если Render hook не настроен, автозапуск деплоя API пропускается.

### Frontend на GitHub Pages

1. Добавьте GitHub Actions repository variable `SURF_CHECK_API_URL` с HTTPS URL API, например `https://<backend-host>`.
2. В **Settings → Pages → Build and deployment** выберите **GitHub Actions**.
3. Отправка коммита в `main` запускает CI, затем сборку и деплой GitHub Pages. Для репозиторной Pages-ссылки Vite автоматически выставляет base path.

### Перенос локальных точек

После настройки Render задайте `SURF_CHECK_API_URL` и `SURF_CHECK_WRITE_TOKEN`, затем отправьте локальный файл:

```sh
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $SURF_CHECK_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @surf_check_spots.json \
  "$SURF_CHECK_API_URL/api/spots"
```

## API

- `GET /healthz` — состояние сервиса.
- `GET /api/state` — данные прогноза и состояние обновления.
- `GET /api/refresh` — запустить обновление.
- `GET /api/spots` — получить конфигурацию точек.
- `POST /api/auth` — проверить токен администратора.
- `POST /api/spots` — валидировать и сохранить точки; требуется `Authorization: Bearer <token>`.

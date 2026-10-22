# Kaliningrad Surf Check

Приложение прогноза для серф-спотов Калининградской области. Код организован как TypeScript monorepo:

- `apps/web/` — React 19, TypeScript, Vite и Leaflet; статический сайт публикуется на GitHub Pages.
- `apps/api/` — Node.js 22, TypeScript и Fastify 5; API размещается на Render.
- `packages/shared/` — общие типы и схемы валидации Zod.
- `tests-ts/` — unit- и API-тесты на Vitest.

Прогноз строится по Open-Meteo Marine и Forecast. Расчёт оценки, проверка опасных условий, редактор точек, вход администратора, компактный/подробный вид карточек, сводная панель и карта с почасовым прогнозом на сегодня и следующие три дня сохранены. Для прошедших часов текущего дня запрашивается архив недавних прогнозов API (`past_days=1`); это архив модельного прогноза, а не фактические измерения на споте. Почасовые карточки в подробном прогнозе используют тот же компактный компонент, что и карточка текущих условий.

Для настройки ветра выберите точку в редакторе и укажите направление движения серфера по волне: от лайнапа туда, куда вы едете. Open-Meteo сообщает метеорологическое направление ветра — откуда он дует; поток направлен на 180° противоположно, и именно этот азимут сравнивается с курсом серфера. Если поток в пределах 45° от курса, это оншор (ветер в спину); если он направлен противоположно курсу (разница 135–180°), это офшор (ветер в лицо); поперёк движения (46–134°) — сайдшор. На карточке стрелка компаса показывает, куда дует ветер, а подпись содержит оба направления. Старые сохранённые значения «от берега к морю» автоматически разворачиваются в направление движения по волне. Вошедшему администратору доступна кнопка редактирования точки прямо из её подробного прогноза.

В методологии оценки можно выбрать любой настроенный спот, дату и час. Для выбранного времени сервер отдельно запрашивает почасовые данные Marine и погодного прогноза; для прошлых дат используется Historical Forecast API. Доступность конкретной даты определяет Open-Meteo: верхнюю/нижнюю границу в интерфейсе не задаём, а если провайдер не имеет нужного часа, показываем его ответ.

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

## Запуск backend в Docker

Нужны Docker Engine и Docker Compose:

```sh
printf 'SURF_CHECK_WRITE_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up --build -d
curl --fail http://localhost:8777/healthz
```

Во втором терминале запустите `corepack pnpm --filter @surf-check/web dev` и откройте <http://localhost:5173>, чтобы протестировать интерфейс с API в контейнере: Vite проксирует запросы на `localhost:8777`. Для одного только API проверяйте `http://localhost:8777/api/state`. Сборка загружает прогноз при запуске и далее каждые пять минут; получение данных зависит от доступности Open-Meteo.

Точки сохраняются в Docker volume `surf-check-data` и переживают пересоздание контейнера. Посмотреть логи: `docker compose logs -f api`; остановить: `docker compose down`. Чтобы удалить контейнер, сохранив данные, достаточно `docker compose down`; не добавляйте `-v`, если не хотите удалить volume.

Если у вас уже есть локальный `surf_check_spots.json`, его можно один раз импортировать в volume:

```sh
docker cp surf_check_spots.json "$(docker compose ps -q api)":/data/surf_check_spots.json
docker compose restart api
```

Для теста только на чтение можно оставить `SURF_CHECK_WRITE_TOKEN` пустым. Для изменения точек используйте созданный токен в кнопке **Войти**. Файл `.env` содержит секрет и не добавляется в Git.

### Развёртывание на хостинге

Соберите образ из корня репозитория и запустите его на хосте с Docker:

```sh
docker build -t surf-check-api:latest .
docker run -d --name surf-check-api --restart unless-stopped \
  -p 8777:8777 \
  -e SURF_CHECK_WRITE_TOKEN='ЗАДАЙТЕ_СЕКРЕТНЫЙ_ТОКЕН' \
  -e CORS_ORIGINS='https://ваш-сайт.example' \
  -v surf-check-data:/data \
  surf-check-api:latest
```

Откройте порт 8777 или поставьте перед контейнером HTTPS reverse proxy. На хостинге задайте `SURF_CHECK_WRITE_TOKEN` и `CORS_ORIGINS` через секреты/переменные окружения; не храните токен в образе. Постоянный volume `/data` обязателен для сохранения отредактированных точек. Для frontend задайте `SURF_CHECK_API_URL` равным публичному HTTPS origin API.

## Разработка и проверки

```sh
corepack pnpm check
```

Команда запускает ESLint, проверку форматирования Prettier, TypeScript typecheck, Vitest и production-сборки API и интерфейса. Отдельно доступны `corepack pnpm dev`, `corepack pnpm test` и `corepack pnpm build`.

## Деплой

### API на Render

1. Создайте бесплатный проект в Neon и скопируйте connection string с SSL.
2. Создайте Blueprint из репозитория и примените `render.yaml`. Для сервиса выберите план **Free**.
3. В Render добавьте `DATABASE_URL` как secret variable, используя Neon connection string. Не добавляйте её в GitHub, Pages или frontend variables.
4. Render создаст `SURF_CHECK_WRITE_TOKEN`; скопируйте его из настроек Environment сервиса и храните как секрет.
5. Задайте `CORS_ORIGINS` как origin GitHub Pages, например `https://USERNAME.github.io` — без пути репозитория.
6. После настройки переменных запустите новый deploy. При первом запуске API создаст таблицу `surf_check_spots`; если она пуста, добавит локальный файл точек (при наличии) или стандартный набор.

CI сначала проверяет сборку. После успешной проверки GitHub Pages публикует фронтенд, а workflow запускает Render Deploy Hook. Если Render hook не настроен, автозапуск деплоя API пропускается.
Бесплатный Render API засыпает после периода бездействия; первый запрос после паузы может ждать запуска около минуты. Данные спотов остаются в Neon и переживают перезапуск или повторный деплой API.

### Frontend на GitHub Pages

1. Добавьте GitHub Actions repository variable `SURF_CHECK_API_URL` с HTTPS URL API, например `https://<backend-host>`.
2. В **Settings → Pages → Build and deployment** выберите **GitHub Actions**.
3. Для GitHub Pages на бесплатном тарифе репозиторий должен быть публичным.
4. Отправка коммита в `main` запускает CI, затем сборку и деплой GitHub Pages. Для репозиторной Pages-ссылки Vite автоматически выставляет base path.

### Перенос локальных точек

После первого запуска API отправьте локальный файл, если хотите заменить стандартный набор спотов своими текущими данными. Укажите токен из настроек Render в переменной окружения терминала, не добавляя его в команду или историю shell:

```sh
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $SURF_CHECK_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @surf_check_spots.json \
  "$SURF_CHECK_API_URL/api/spots"
```

После успешного ответа проверьте `GET https://<backend-host>/api/spots`. Последующие изменения через админку будут записываться напрямую в Neon. Не используйте `SURF_CHECK_WRITE_TOKEN` или `DATABASE_URL` в переменных с префиксом `VITE_`: эти значения попадут в публичный frontend.

## API

- `GET /healthz` — состояние сервиса.
- `GET /api/state` — данные прогноза и состояние обновления.
- `GET /api/refresh` — запустить обновление.
- `GET /api/spots` — получить конфигурацию точек.
- `POST /api/auth` — проверить токен администратора.
- `POST /api/spots` — валидировать и сохранить точки; требуется `Authorization: Bearer <token>`.

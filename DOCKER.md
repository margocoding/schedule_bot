# Docker Deployment Guide

## Структура Docker setup

Этот проект использует Docker Compose для управления тремя сервисами:
- **MongoDB** - база данных для хранения букингов и пользователей
- **Redis** - очередь задач для напоминаний о букингах
- **App** - Node.js приложение (Telegram бот)

## Требования

- Docker 20.10+
- Docker Compose 2.0+

## Быстрый старт

### 1. Подготовка

```bash
# Клонируйте репозиторий и перейдите в директорию
cd beauty-schedule-bot

# Убедитесь, что .env файл заполнен правильно
cat .env
```

### 2. Запуск

```bash
# Запуск всех сервисов в фоне
docker-compose up -d

# Просмотр логов
docker-compose logs -f app

# Просмотр логов конкретного сервиса
docker-compose logs -f mongodb
docker-compose logs -f redis
```

### 3. Проверка статуса

```bash
# Показать статус контейнеров
docker-compose ps

# Проверить здоровье контейнеров
docker inspect --format='{{.State.Health.Status}}' beauty-schedule-bot
docker inspect --format='{{.State.Health.Status}}' beauty-schedule-mongodb
docker inspect --format='{{.State.Health.Status}}' beauty-schedule-redis
```

## Управление

### Остановка сервисов

```bash
# Остановить все контейнеры (данные сохранятся)
docker-compose stop

# Остановить и удалить контейнеры (данные в volumes сохранятся)
docker-compose down

# Остановить и удалить контейнеры + volumes (все данные будут удалены!)
docker-compose down -v
```

### Перезагрузка приложения

```bash
# Пересобрать образ приложения
docker-compose build --no-cache app

# Перезапустить приложение
docker-compose restart app

# Или в одну команду
docker-compose up -d --build app
```

### Просмотр логов

```bash
# Все логи с timestamp
docker-compose logs -t

# Последние 100 строк
docker-compose logs --tail=100

# Следить за логами в реальном времени
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f app
docker-compose logs -f mongodb
docker-compose logs -f redis
```

## Доступ к сервисам

После запуска `docker-compose up -d`:

- **MongoDB**: `mongodb://admin:password123@localhost:27017/beauty-schedule-bot`
  - Пользователь: `admin`
  - Пароль: `password123`
  - Для подключения используйте MongoDB Compass или mongosh

- **Redis**: `redis://:password123@localhost:6379`
  - Пароль: `password123`
  - Для подключения используйте Redis CLI

- **Приложение**: Telegram бот работает и слушает команды

## Переменные окружения

Основные переменные находятся в `.env` файле:

```env
TELEGRAM_TOKEN=          # Telegram Bot Token
MONGODB_URI=             # URI для MongoDB (автоматически в Docker)
REDIS_URL=               # URI для Redis (автоматически в Docker)
ADMIN_TELEGRAM_IDS=      # ID администраторов (запятая-разделённые)
CONTACT_PHONE=           # Номер телефона салона
ADDRESS=                 # Адрес салона
SUPPORT_URL=             # URL поддержки
PORTFOLIO_URL=           # URL портфолио
```

## Настройка паролей (важно!)

Для production измените пароли:

1. В `docker-compose.yml`:
   - Измените `password123` на `MONGO_INITDB_ROOT_PASSWORD`
   - Измените `password123` на параметр Redis `--requirepass`

2. Обновите в `.env`:
   - `MONGODB_URI`
   - `REDIS_URL`

## Ограничения портов

По умолчанию открыты порты:
- `27017` - MongoDB
- `6379` - Redis
- `3000` - Приложение

Если нужны другие порты, измените в `docker-compose.yml` строки с `ports:`.

## Проблемы и решения

### Приложение не может подключиться к MongoDB

```bash
# Проверьте, что MongoDB запущена
docker-compose ps

# Посмотрите логи MongoDB
docker-compose logs mongodb

# Проверьте сетевое соединение
docker-compose exec app ping mongodb
```

### Ошибки при запуске

```bash
# Пересоберите образ без кэша
docker-compose build --no-cache

# Очистите старые образы
docker system prune -a
```

### Данные не сохраняются

Убедитесь, что volumes правильно смонтированы:

```bash
# Проверьте volumes
docker volume ls | grep beauty-schedule

# Если нужно удалить volumes (внимание! данные будут потеряны)
docker volume rm beauty-schedule-bot_mongodb_data beauty-schedule-bot_redis_data
```

## Production рекомендации

1. **Изменить пароли** - не используйте `password123`
2. **Использовать .env.production** - для чувствительных данных
3. **Настроить резервное копирование** - для MongoDB и Redis volumes
4. **Использовать reverse proxy** - например Nginx или Traefik
5. **Включить SSL/TLS** - для защиты трафика
6. **Мониторить логи** - настроить логирование и мониторинг
7. **Ограничить ресурсы** - добавить `resources` в docker-compose.yml

## Развёртывание на сервер

```bash
# SSH на сервер
ssh user@your-server

# Клонируйте репозиторий
git clone <repository-url>
cd beauty-schedule-bot

# Создайте .env файл с правильными значениями
nano .env

# Запустите Docker Compose
docker-compose up -d

# Проверьте статус
docker-compose ps
```

## Дополнительные команды

```bash
# Выполнить команду в контейнере приложения
docker-compose exec app npm run build

# Посмотреть использование ресурсов
docker stats

# Очистить неиспользуемые образы и контейнеры
docker system prune

# Экспортировать/импортировать базу данных
docker-compose exec mongodb mongodump --out /tmp/dump
docker-compose exec mongodb mongorestore /tmp/dump
```

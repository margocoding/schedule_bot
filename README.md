# 💇‍♀️ Beauty Schedule Bot

Telegram бот для управления расписанием и записями в салоне красоты.

## ✨ Возможности

- 📅 **Онлайн запись** - клиенты могут выбрать услугу, дату и время
- 🔔 **Автоматические напоминания** - напоминания за 24 часа до визита
- 👨‍💼 **Админ-панель** - управление услугами, расписанием и контактами
- 📱 **Номер телефона** - запрашивается при выборе времени записи
- 💾 **MongoDB** - сохранение всех данных
- 📬 **Redis** - очередь для напоминаний

## 🚀 Быстрый старт

### Требования

- Docker 20.10+
- Docker Compose 2.0+
- ИЛИ Node.js 20+, MongoDB 7+, Redis 7+

### Вариант 1: Docker (Рекомендуется)

```bash
# Клонируйте репозиторий
git clone <your-repo-url>
cd beauty-schedule-bot

# Скопируйте переменные окружения
cp .env.example .env

# Отредактируйте .env с вашими значениями
nano .env  # или используйте ваш редактор

# Запустите контейнеры
docker-compose up -d

# Проверьте статус
docker-compose ps

# Просмотрите логи
docker-compose logs -f app
```

### Вариант 2: Локальная разработка

```bash
# Установите зависимости
npm install

# Запустите локально (нужна локальная MongoDB и Redis)
npm run dev
```

### Вариант 3: Docker с синхронизацией файлов (для разработки)

```bash
# Запустите с автоматической перезагрузкой при изменении файлов
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# ИЛИ используйте Makefile
make docker-dev
```

## 📋 Команды

### Docker команды

```bash
# Запустить все сервисы
docker-compose up -d

# Остановить
docker-compose down

# Просмотреть логи
docker-compose logs -f

# Пересобрать образ
docker-compose build --no-cache

# Очистить всё (включая данные!)
docker-compose down -v
```

### Makefile команды (если установлен make)

```bash
# Развёртывание
make docker-up          # Запустить
make docker-down        # Остановить
make docker-build       # Пересобрать

# Разработка
make docker-dev         # Режим разработки с hot-reload
make docker-dev-build   # Пересобрать в режиме разработки

# Логи
make docker-logs        # Логи всех сервисов
make docker-logs-app    # Логи приложения

# Управление
make docker-ps          # Показать контейнеры
make docker-clean       # Удалить контейнеры и volumes
make docker-health      # Проверить здоровье

# Доступ
make docker-shell-app   # Sh в приложении
make docker-shell-db    # MongoDB shell
make docker-shell-redis # Redis CLI
```

## 🔧 Конфигурация

### Переменные окружения

Скопируйте `.env.example` в `.env` и отредактируйте:

```env
TELEGRAM_TOKEN=          # Получите у @BotFather
MONGODB_URI=             # Автоматически в Docker
REDIS_URL=               # Автоматически в Docker
ADMIN_TELEGRAM_IDS=      # Ваш Telegram ID (от @userinfobot)
CONTACT_PHONE=           # Номер телефона салона
ADDRESS=                 # Адрес салона
SUPPORT_URL=             # Ссылка на поддержку (Telegram)
PORTFOLIO_URL=           # Ссылка на портфолио (Telegram канал)
```

### Доступ к сервисам

После запуска:

- **MongoDB**: `mongodb://admin:password123@localhost:27017/beauty-schedule-bot`
  - GUI: используйте MongoDB Compass
  - CLI: `make docker-shell-db`

- **Redis**: `redis://:password123@localhost:6379`
  - CLI: `make docker-shell-redis` или `redis-cli`

- **Бот**: работает и слушает Telegram команды

## 📁 Структура проекта

```
beauty-schedule-bot/
├── Dockerfile              # Docker образ приложения
├── docker-compose.yml      # Основная конфигурация Docker
├── docker-compose.dev.yml  # Конфигурация для разработки
├── Makefile                # Удобные команды
├── DOCKER.md               # Подробная документация Docker
├── app.ts                  # Основное приложение бота
├── config/
│   └── config.ts           # Конфигурация переменных
├── db/
│   ├── mongo.ts            # Подключение MongoDB
│   └── redis.ts            # Подключение Redis
├── models/                 # MongoDB Schemas
├── queues/                 # BullMQ очереди
├── utils/                  # Вспомогательные функции
└── types/                  # TypeScript типы
```

## 🤖 Использование бота

### Для пользователей

1. Откройте бот в Telegram
2. Нажмите `/start`
3. Поделитесь номером телефона (или напишите его при выборе времени)
4. Выберите услугу
5. Выберите дату и время
6. Подтвердите запись
7. Получайте напоминания за 24 часа до визита

### Для администраторов

1. Нажмите кнопку "Админ-панель" или команду `/admin`
2. Управляйте:
   - Календарём (открыть/закрыть дни)
   - Услугами (добавить/удалить)
   - Рабочим днём (начало/конец)
   - Контактами и адресом
   - Ссылками на поддержку и портфолио

## 📊 Мониторинг

### Проверка здоровья

```bash
# Проверить статус всех сервисов
make docker-health

# ИЛИ вручную
docker-compose ps
docker inspect --format='{{.State.Health.Status}}' beauty-schedule-bot
```

### Логи

```bash
# Все логи
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f app
docker-compose logs -f mongodb
docker-compose logs -f redis

# Последние N строк
docker-compose logs --tail=100
```

## 🔐 Безопасность

### Для Production

1. **Измените пароли**:
   - MongoDB: в `docker-compose.yml` (MONGO_INITDB_ROOT_PASSWORD)
   - Redis: в `docker-compose.yml` (--requirepass)
   - Обновите `.env`

2. **Используйте `.env.production`** для чувствительных данных

3. **Включите SSL/TLS** через reverse proxy (Nginx, Traefik)

4. **Ограничьте доступ** к портам (используйте файрволл)

5. **Настройте резервное копирование**:
   ```bash
   # Бэкап MongoDB
   make docker-backup-db
   
   # Восстановление
   make docker-restore-db
   ```

## 🐛 Решение проблем

### Приложение не запускается

```bash
# Проверьте логи
docker-compose logs app

# Проверьте .env файл
cat .env

# Пересоберите образ
docker-compose build --no-cache app
docker-compose up -d
```

### MongoDB не подключается

```bash
# Проверьте MongoDB
docker-compose logs mongodb
docker-compose exec mongodb mongosh -u admin -p password123

# Перезапустите
docker-compose restart mongodb
```

### Redis недоступен

```bash
# Проверьте Redis
docker-compose logs redis
docker-compose exec redis redis-cli -a password123 ping

# Перезапустите
docker-compose restart redis
```

### Удалить всё и начать заново

```bash
# Остановить и удалить всё (включая данные!)
docker-compose down -v

# Пересобрать
docker-compose build --no-cache

# Запустить заново
docker-compose up -d
```

## 📚 Дополнительная информация

- [DOCKER.md](./DOCKER.md) - Подробная документация по Docker
- [Telegraf документация](https://telegraf.js.org/)
- [MongoDB документация](https://docs.mongodb.com/)
- [Redis документация](https://redis.io/documentation)

## 🤝 Разработка

### Требования

- Node.js 20+
- TypeScript

### Установка для разработки

```bash
git clone <your-repo-url>
cd beauty-schedule-bot
npm install
npm run dev
```

### Рекомендуемый workflow

```bash
# Используйте Docker Compose для БД
docker-compose up mongodb redis -d

# Запустите приложение локально
npm run dev
```

## 📞 Поддержка

Если возникли вопросы:
- Посмотрите логи: `docker-compose logs -f`
- Проверьте конфигурацию: `cat .env`
- Читайте [DOCKER.md](./DOCKER.md)

## 📄 Лицензия

ISC

## 🙏 Спасибо

Создано с ❤️ для красивых салонов красоты

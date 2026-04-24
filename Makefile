.PHONY: help docker-up docker-down docker-logs docker-build docker-ps docker-clean docker-dev docker-prod

help:
	@echo "Beauty Schedule Bot - Docker Commands"
	@echo ""
	@echo "Usage:"
	@echo "  make docker-up          - Start all services"
	@echo "  make docker-down        - Stop all services"
	@echo "  make docker-ps          - Show running containers"
	@echo "  make docker-logs        - Show logs"
	@echo "  make docker-logs-app    - Show app logs"
	@echo "  make docker-build       - Build images"
	@echo "  make docker-clean       - Remove containers and volumes"
	@echo "  make docker-dev         - Run in development mode"
	@echo "  make docker-prod        - Run in production mode"
	@echo "  make docker-shell-app   - Open shell in app container"
	@echo "  make docker-shell-db    - Open shell in MongoDB"
	@echo ""

# Development
docker-dev:
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

docker-dev-build:
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# Production
docker-prod:
	docker-compose up -d

docker-prod-build:
	docker-compose up -d --build

# General
docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

docker-ps:
	docker-compose ps

docker-logs:
	docker-compose logs -f

docker-logs-app:
	docker-compose logs -f app

docker-logs-db:
	docker-compose logs -f mongodb

docker-logs-redis:
	docker-compose logs -f redis

docker-build:
	docker-compose build --no-cache

docker-clean:
	docker-compose down -v
	docker system prune -f

# Shell access
docker-shell-app:
	docker-compose exec app sh

docker-shell-db:
	docker-compose exec mongodb mongosh -u admin -p password123

docker-shell-redis:
	docker-compose exec redis redis-cli

# Specific services
docker-restart-app:
	docker-compose restart app

docker-restart-db:
	docker-compose restart mongodb

docker-restart-redis:
	docker-compose restart redis

# Database backup
docker-backup-db:
	docker-compose exec mongodb mongodump --out /tmp/backup -u admin -p password123 --authenticationDatabase admin

docker-restore-db:
	docker-compose exec mongodb mongorestore /tmp/backup -u admin -p password123 --authenticationDatabase admin

# Health check
docker-health:
	@echo "App health:" && docker inspect --format='{{.State.Health.Status}}' beauty-schedule-bot || echo "N/A"
	@echo "MongoDB health:" && docker inspect --format='{{.State.Health.Status}}' beauty-schedule-mongodb || echo "N/A"
	@echo "Redis health:" && docker inspect --format='{{.State.Health.Status}}' beauty-schedule-redis || echo "N/A"

# Resource usage
docker-stats:
	docker stats --no-stream

# Remove all
docker-prune:
	docker system prune -a --volumes -f

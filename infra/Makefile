.PHONY: deploy ssh logs up down build

COMPOSE := docker compose -f docker-compose.yml
COMPOSE_PROD := docker compose -f docker-compose.yml -f docker-compose.prod.yml
EC2_HOST ?= ubuntu@orebase-ingest

deploy:
	$(COMPOSE_PROD) up -d --build

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f --tail=200

ssh:
	ssh $(EC2_HOST)

.PHONY: deploy ssh logs up down build

COMPOSE := docker compose -f docker-compose.yml
EC2_HOST ?= ubuntu@orebase-ingest

deploy:
	$(COMPOSE) up -d --build

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

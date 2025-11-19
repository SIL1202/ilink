#!/bin/bash
docker compose down
docker compose up -d --build
docker compose ps
docker logs ilink-backend-1

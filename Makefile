SHELL := /bin/bash

.PHONY: dev setup db-up db-down migrate cluster-up cluster-down cluster-status

# Install everything, start Postgres, apply migrations, and run both dev servers.
dev:
	./scripts/dev.sh

# Same setup without starting the API and console.
setup:
	./scripts/dev.sh --setup

# Start only the local PostgreSQL service.
db-up:
	docker compose up -d --wait postgres

# Stop the local PostgreSQL service. Data is kept in the named volume.
db-down:
	docker compose down

# Apply pending Drizzle migrations to the local database.
migrate: db-up
	cd apps/api && bun run db:migrate

# Create a disposable local k3d cluster with Cilium.
cluster-up:
	./scripts/cluster.sh up

# Delete the local k3d cluster and its kubeconfig.
cluster-down:
	./scripts/cluster.sh down

# Show the local cluster, its nodes, and Cilium pods.
cluster-status:
	./scripts/cluster.sh status

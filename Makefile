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

# Create the local cluster in an OrbStack machine (k3s, Cilium, SeaweedFS, VictoriaMetrics, VictoriaLogs).
cluster-up:
	./scripts/cluster.sh up

# Delete the OrbStack machine and its kubeconfig.
cluster-down:
	./scripts/cluster.sh down

# Show the OrbStack machine, its nodes, pods and StorageClasses.
cluster-status:
	./scripts/cluster.sh status

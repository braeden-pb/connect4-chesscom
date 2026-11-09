# Connect Four

A two-player Connect Four game built for the Chess.com Product Engineering internship take-home. React + Vite + TypeScript frontend, Go standard-library REST API and game engine, PostgreSQL persistence, Docker Compose, and minimal Kubernetes manifests.

## Run locally (one command)

Requires Docker Engine/Desktop with Docker Compose v2 and internet access for first-time image/dependency downloads.

```sh
docker compose up --build -d
```

Open **http://localhost:8088**. Run `docker compose ps` to check readiness and `docker compose logs -f` to inspect failures. Stop with `docker compose down`; `docker compose down -v` also **deletes saved games**. Set `PORT` to change the host port and `POSTGRES_PASSWORD` before first initialization to override the local-development default. PostgreSQL is not exposed on the host.

## How to play

Click a column to drop a disc. Red goes first; turns alternate. Four adjacent discs horizontally, vertically, or diagonally wins. A full board without a winner is a draw. **New game** creates a fresh match. Refreshing the page restores the current match from the API.

## Architecture

- `frontend/`: React + Vite + TypeScript; Nginx serves the production build and proxies `/api` to Go. Browser stores only the game ID.
- `backend/internal/game/`: dependency-free rules (6×7 board, gravity, validation, alternating turns, wins, draws).
- `backend/internal/api/`: REST handler and JSON/error mapping; does not calculate game rules.
- `backend/internal/repository/`: PostgreSQL repository. Stores a JSONB move list and replays it through the engine on reads. `SELECT ... FOR UPDATE` in a transaction serializes concurrent moves.
- `database/init.sql`: creates the games table on first database initialization.
- `compose.yaml` and `k8s/connect4.yaml`: local three-service deployment and minimal Kubernetes example.

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/games` | Create game (`201`) |
| GET | `/api/games/{id}` | Get state (`200`) |
| POST | `/api/games/{id}/moves` | Send `{ "column": 3 }` (`200`) |

Columns are zero-based (0–6). Responses contain `id`, `board` (0 empty, 1 red, 2 yellow), `turn`, `status`, `winner`, and `moves`; move responses include `row`. Errors are JSON `{ "error": "..." }`: `400` invalid input, `404` unknown game, `405` wrong method, `409` illegal move or finished game, `500` server/storage error.

## Tests

```sh
(cd backend && go mod tidy && go test ./... -count=1 && go vet ./...)
(cd frontend && npm install && npm test && npm run build)
python -m unittest discover -s tests -p 'test_*.py'
```

For a manual **end-to-end check**, after Compose is healthy: create a game, alternate moves in columns `0,0,1,1,2,2,3` and confirm a Red horizontal win, then refresh and confirm the win persists; check that further moves are blocked and **New game** resets the board. Check full-column validation and the draw scenario as well. A command-line API smoke check:

```sh
curl -i -X POST http://localhost:8088/api/games
# Copy the returned id into the following commands:
curl http://localhost:8088/api/games/REPLACE_ID
curl -i -X POST http://localhost:8088/api/games/REPLACE_ID/moves -H 'Content-Type: application/json' -d '{"column":3}'
```

**Verification performed in the supplied execution environment:** Go internal unit tests, including an HTTP create-to-win lifecycle test using an in-memory store, passed; `go vet ./internal/...` passed; six frontend source-level smoke tests passed; four infrastructure YAML/configuration tests passed. **Not verified:** `go test ./...`, `go vet ./...`, frontend TypeScript/production build, real PostgreSQL integration, browser interaction, Docker Compose startup, and Kubernetes deployment. Go module downloads failed because the Go proxy was unreachable; npm dependencies were not installed; Docker and kubectl were unavailable. Source-level and in-memory tests are **not** substitutes for a live end-to-end run. Do not claim end-to-end success until the commands and manual flow above pass on a machine with dependencies and Docker.

## Kubernetes (optional)

The manifests are a **development demonstration**. With a local Kubernetes cluster, build and make images `connect4-backend:local` and `connect4-frontend:local` available to its runtime (for kind, use `kind load docker-image ...`). Then:

```sh
kubectl apply -f k8s/connect4.yaml
kubectl rollout status deployment/db
kubectl rollout status deployment/backend
kubectl rollout status deployment/frontend
kubectl port-forward svc/frontend 8088:80
```

Requires a default StorageClass for the PostgreSQL PVC. Replace development credentials before deployment. No production TLS, backups, migrations for existing databases, or hardened secret management are included.

## Decisions and trade-offs

Prioritized a reliable two-player game over accounts, AI opponents, and online matchmaking. The Go standard library keeps the API small. Move-history JSONB makes persistence simple and keeps the game engine authoritative, at the cost of replaying moves (at most 42). Row-level locking avoids concurrent update races. Docker Compose is the primary single-command experience; Kubernetes is intentionally minimal rather than production-ready. With more time: live PostgreSQL integration tests, automated browser tests, schema migrations, observability, and deployment hardening.

## Submission notes

Record **actual** time spent on engine, API/database, frontend, infrastructure, and verification/documentation; do not estimate it as measured time. Include AI agent transcripts with the repository submission as requested by the assignment.

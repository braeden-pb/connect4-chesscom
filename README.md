# Connect Four

A polished, responsive Connect Four game with local play, online multiplayer, and spectator mode. The project uses a React, Vite, and TypeScript frontend, a Go REST API and game engine, PostgreSQL persistence, and Docker Compose.

## Features

- Play a two-player, turn-based game on a 7-column by 6-row board.
- Create local games or online games with a shareable invite link.
- Let a second player join an online game as Yellow; additional visitors can spectate.
- See online board and lobby updates automatically while the page is open.
- Review move history and see the winning four highlighted and connected by a line.
- Get a centered victory message; online losers also see a defeat message.
- Track Red and Yellow wins in a browser-persistent scoreboard.
- Choose Classic, Neon Grid, or Retro Sunset backgrounds.
- Control background music, music style and volume, and game sound effects.
- Play with a mouse, touch screen, or keyboard.

## Run locally

Requires Docker Engine/Desktop with Docker Compose v2. The first build needs internet access to download container images and frontend dependencies.

```sh
docker compose up --build -d
```

Open **http://localhost:8089**. Check service status with `docker compose ps` and view logs with `docker compose logs -f`. Stop the services with `docker compose down`. This preserves saved games in the PostgreSQL volume; `docker compose down -v` also **deletes the database and saved games**.

The frontend port defaults to `8089`; set `PORT` to use a different host port. Set `POSTGRES_PASSWORD` before the database is first initialized to override the local-development password. PostgreSQL is not exposed on the host. Do not use the development credentials for a public deployment.

## How to play

Choose a column to drop your disc. Red goes first, and the players alternate turns. The first player to connect four discs horizontally, vertically, or diagonally wins. A full board without a winner is a draw. Select **New game** to start a fresh local game.

### Keyboard controls

1. Press **Tab** until a board column has a white outline.
2. Press **Left Arrow** or **Right Arrow** to choose a column.
3. Press **Enter** or **Space** to drop your disc.

### Online games and spectators

1. Select **Start online game**.
2. Select **Copy game link** and send the link to your opponent.
3. The first visitor to select **Join as Player 2** takes the Yellow seat. The creator is Red.
4. Other visitors who open the link watch the game as read-only spectators.

Players can only make moves on their turns, after both seats are filled. Spectators can see the public board and move history update automatically, but cannot make moves. The page refreshes online game state about every 1.5 seconds.

#### Rematches

After an online game ends, either player can select **Play again**. This creates a separate match with an empty board and fresh player credentials while keeping the same Red and Yellow seats. The other player stays on the completed match page; when **Join rematch** appears, they select it to enter the new match. Once both players have entered, play starts with Red. Spectators cannot request or join a rematch as players. Share the new match link if you want spectators to follow the rematch.

For someone outside your local network to open an invite, the app must be reachable at a public address. For a temporary test link, run a tunnel in a separate terminal while Docker Compose is running:

If `cloudflared` is not installed on Windows, install it with:

```powershell
winget install --id Cloudflare.cloudflared
```

Then start the tunnel:

```sh
cloudflared tunnel --url http://localhost:8089
```

Open the HTTPS address printed by `cloudflared`, start a **new online game from that address**, and copy its invite link. Starting the game at the public address matters because player credentials are stored in that browser's local storage and do not transfer from `localhost`. Keep the computer, Docker Compose, and tunnel running while playing. A quick tunnel is temporary, has no uptime guarantee, and its address can change when restarted. Anyone with an invite can view the match; a player token is required to make moves.

## Architecture

- `frontend/`: React, Vite, and TypeScript application. Nginx serves the production build and proxies `/api` requests to Go. The browser stores game IDs, online player tokens, theme preference, and the local scoreboard.
- `backend/internal/game/`: game rules, including gravity, move validation, alternating turns, wins, and draws.
- `backend/internal/api/`: REST handlers, validation, JSON responses, and error mapping.
- `backend/internal/repository/`: PostgreSQL persistence and serialized move updates.
- `backend/cmd/server/`: API startup and database migration.
- `database/init.sql`: initial schema for a new database.
- `compose.yaml`: local frontend, backend, and PostgreSQL services.
- `k8s/connect4.yaml`: optional Kubernetes demonstration manifests.

Online games store separate player credentials server-side as hashes. The creator receives the Red credential and the joining player receives the Yellow credential. Public game reads include board and lobby state, not player credentials. Spectating does not require a credential. Online state is stored in PostgreSQL; local preferences and the scoreboard are per browser.

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/games` | Create a local game |
| POST | `/api/games/online` | Create an online game and return the creator's player token |
| GET | `/api/games/{id}` | Read public game state |
| POST | `/api/games/{id}/join` | Join an online game as Player 2 |
| POST | `/api/games/{id}/rematch` | Create or enter the next match using `X-Player-Token` |
| POST | `/api/games/{id}/moves` | Drop a disc; online players send `X-Player-Token` |

Move requests contain a zero-based column from 0 to 6, for example `{ "column": 3 }`. A game response includes `id`, `board` (0 empty, 1 Red, 2 Yellow), `turn`, `status`, `winner`, `moves`, `history`, `online`, `playersJoined`, and `rematchId` when a rematch has been created. Move responses also include the landing `row`. A rematch request is authorized with the player's token for the completed match; it returns the new game state, the caller's seat, and that seat's fresh token. The same player can retry if needed without changing the new credential. Errors are JSON objects with an `error` message; common status codes are `400` invalid input, `403` invalid player token, `404` unknown game, and `409` illegal move, unfilled player seats, unfinished games, or a rematch that has already started.

## Development and tests

Run the backend tests and static checks:

```sh
cd backend
go test ./... -count=1
go vet ./...
```

Run the frontend tests and production build:

```sh
cd frontend
npm ci
npm test
npm run build
```

The frontend development server can be started with `npm run dev`. It uses the Vite API proxy configured for the local Go backend.

## Kubernetes (optional)

The manifests are a development demonstration, not a production deployment. Build and make the `connect4-backend:local` and `connect4-frontend:local` images available to your cluster (for kind, use `kind load docker-image ...`). Then:

```sh
kubectl apply -f k8s/connect4.yaml
kubectl rollout status deployment/db
kubectl rollout status deployment/backend
kubectl rollout status deployment/frontend
kubectl port-forward svc/frontend 8089:80
```

This requires a default StorageClass for the PostgreSQL PVC. Replace development credentials before deployment. Production TLS, backups, hardened secret management, and operational monitoring are not configured.

## Current limitations

- Online games use periodic polling rather than WebSockets.
- There are no user accounts, matchmaking, chat, or server-wide scoreboard. The win totals are stored locally in each browser.
- An online invite is a bearer link for public viewing; protect it if you do not want others to spectate.
- Cloudflare quick tunnels are temporary test links, not permanent hosting.
- Kubernetes configuration is illustrative and is not production hardened.

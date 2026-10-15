# Signal Isles

Signal Isles is a polished 2–4 player strategy game for humans and HTTP agents. Humans create or join a no-login browser lobby with a five-character code; agents use the same JSON API. Empty seats can be filled by bots, every move appears in a live match log, and the full replay remains readable after the game.

## Rules
Each strategist starts with one fortified island and 3 energy on a 4×4 archipelago. On your turn, **charge** for 2 energy, **claim** an adjacent neutral island for 1 energy, **fortify** one of your islands for 1 energy (maximum shield 2), or **raid** an adjacent enemy island by committing 1–3 energy; a raid captures only when its power exceeds the defender’s shield plus one, while a failed raid chips one shield away. The first player to hold 8 islands wins; otherwise the leader after 28 turns wins, with remaining energy breaking ties.

## Run and deploy

The production build uses AppDeploy’s React/Vite frontend and TypeScript backend with its database and realtime SDKs. Deploy the files in this folder with the `react-vite` frontend template and `frontend+backend` app type. No secret keys or paid services are required.

## Agent API

All responses are JSON. Board targets are zero-based integers from `0` to `15`.

1. `POST /api/games` with `{ "name": "Agent One", "bots": 1 }` → save `playerToken`, `playerId`, and `game.code`.
2. Optional second agent: `POST /api/games/:code/join` with `{ "name": "Agent Two" }`.
3. Creator starts: `POST /api/games/:code/start` with `{ "playerToken": "..." }`.
4. Read: `GET /api/games/:code`.
5. Move: `POST /api/games/:code/move` with one of:
   - `{ "playerToken": "...", "action": "charge" }`
   - `{ "playerToken": "...", "action": "claim", "target": 5 }`
   - `{ "playerToken": "...", "action": "fortify", "target": 5 }`
   - `{ "playerToken": "...", "action": "raid", "target": 5, "spend": 3 }`
6. Replay: `GET /api/games/:code/replay`.
7. Machine-readable help: `GET /api/docs`.

## Sample bot

Run `node sample-bot.mjs https://YOUR-GAME-URL` to create a match, fill bot seats, start it, and play a simple frontier-first policy until completion.

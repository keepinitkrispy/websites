import { db, error, json, router, ws } from '@appdeploy/sdk';

type Cell = { owner: string | null; shield: number };
type Player = { id: string; name: string; token: string; bot: boolean; energy: number };
type LogEntry = { turn: number; actor: string; text: string };
type Game = {
  id: string;
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  players: Player[];
  cells: Cell[];
  turnIndex: number;
  turnCount: number;
  maxTurns: number;
  winnerId: string | null;
  log: LogEntry[];
  version: number;
  createdAt: string;
};

type Move = { action: 'charge' | 'claim' | 'raid' | 'fortify'; target?: number; spend?: number };

const GAMES = 'signal_isles_games';
const SUBSCRIPTIONS = 'signal_isles_subscriptions';
const BOARD_SIZE = 16;
const STARTS = [0, 15, 3, 12];

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < 5; index += 1) value += chars[Math.floor(Math.random() * chars.length)];
  return value;
}

function randomToken() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

function cleanName(value: unknown, fallback = 'Strategist') {
  const name = String(value ?? '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 20);
  return name || fallback;
}

function publicGame(game: Game) {
  return {
    ...game,
    players: game.players.map(({ token: _token, ...player }) => player),
  };
}

function adjacent(a: number, b: number) {
  const ax = a % 4;
  const ay = Math.floor(a / 4);
  const bx = b % 4;
  const by = Math.floor(b / 4);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

function ownedCells(game: Game, playerId: string) {
  return game.cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell.owner === playerId);
}

function score(game: Game, playerId: string) {
  return ownedCells(game, playerId).length;
}

function reachable(game: Game, playerId: string, target: number) {
  return ownedCells(game, playerId).some(({ index }) => adjacent(index, target));
}

function summarize(game: Game) {
  return game.players.map((player) => ({
    id: player.id,
    name: player.name,
    cells: score(game, player.id),
    energy: player.energy,
  })).sort((a, b) => b.cells - a.cells || b.energy - a.energy);
}

function finishIfNeeded(game: Game) {
  const standing = summarize(game);
  const leader = standing[0];
  if (leader && (leader.cells >= 8 || game.turnCount >= game.maxTurns)) {
    game.status = 'finished';
    game.winnerId = leader.id;
    game.log.push({ turn: game.turnCount, actor: 'System', text: `${leader.name} wins with ${leader.cells} islands and ${leader.energy} energy.` });
  }
}

function applyMove(game: Game, player: Player, move: Move) {
  if (game.status !== 'playing') throw new Error('Game is not active');
  if (game.players[game.turnIndex]?.id !== player.id) throw new Error('It is not your turn');
  const action = move.action;
  let text = '';

  if (action === 'charge') {
    player.energy = Math.min(8, player.energy + 2);
    text = `${player.name} channels the tide and gains 2 energy.`;
  } else {
    const target = Number(move.target);
    if (!Number.isInteger(target) || target < 0 || target >= BOARD_SIZE) throw new Error('Choose a valid island');
    const cell = game.cells[target];
    if (action === 'claim') {
      if (cell.owner !== null) throw new Error('Only neutral islands can be claimed');
      if (!reachable(game, player.id, target)) throw new Error('Claim must touch one of your islands');
      if (player.energy < 1) throw new Error('Claiming costs 1 energy');
      player.energy -= 1;
      cell.owner = player.id;
      text = `${player.name} claims island ${target + 1}.`;
    } else if (action === 'fortify') {
      if (cell.owner !== player.id) throw new Error('You can only fortify your own island');
      if (cell.shield >= 2) throw new Error('That island is already fully fortified');
      if (player.energy < 1) throw new Error('Fortifying costs 1 energy');
      player.energy -= 1;
      cell.shield += 1;
      text = `${player.name} fortifies island ${target + 1} to shield ${cell.shield}.`;
    } else if (action === 'raid') {
      const spend = Math.max(1, Math.min(3, Number(move.spend) || 1));
      if (!cell.owner || cell.owner === player.id) throw new Error('Raid an enemy-owned island');
      if (!reachable(game, player.id, target)) throw new Error('Raid must touch one of your islands');
      if (player.energy < spend) throw new Error(`Raiding costs the committed ${spend} energy`);
      player.energy -= spend;
      const defense = cell.shield + 1;
      if (spend > defense) {
        const defender = game.players.find((candidate) => candidate.id === cell.owner);
        cell.owner = player.id;
        cell.shield = 0;
        text = `${player.name} captures island ${target + 1} from ${defender?.name ?? 'a rival'} with ${spend} power.`;
      } else {
        cell.shield = Math.max(0, cell.shield - 1);
        text = `${player.name}'s ${spend}-power raid on island ${target + 1} fails; its shield drops to ${cell.shield}.`;
      }
    } else {
      throw new Error('Unknown action');
    }
  }

  game.turnCount += 1;
  game.log.push({ turn: game.turnCount, actor: player.name, text });
  finishIfNeeded(game);
  if (game.status === 'playing') game.turnIndex = (game.turnIndex + 1) % game.players.length;
}

function legalBotMove(game: Game, player: Player): Move {
  const frontier = game.cells.map((cell, target) => ({ cell, target })).filter(({ target }) => reachable(game, player.id, target));
  const neutral = frontier.filter(({ cell }) => cell.owner === null);
  const enemies = frontier.filter(({ cell }) => cell.owner && cell.owner !== player.id);
  if (neutral.length && player.energy >= 1) return { action: 'claim', target: neutral[Math.floor(Math.random() * neutral.length)].target };
  const vulnerable = enemies.filter(({ cell }) => player.energy >= cell.shield + 2 && cell.shield < 2);
  if (vulnerable.length) {
    const choice = vulnerable[Math.floor(Math.random() * vulnerable.length)];
    return { action: 'raid', target: choice.target, spend: Math.min(3, choice.cell.shield + 2) };
  }
  const own = ownedCells(game, player.id).filter(({ cell }) => cell.shield < 2);
  if (own.length && player.energy >= 3 && Math.random() > 0.45) return { action: 'fortify', target: own[Math.floor(Math.random() * own.length)].index };
  return { action: 'charge' };
}

async function loadGame(code: string) {
  const [game] = await db.get<Game>(GAMES, [code.toUpperCase()], { consistent: true });
  return game;
}

async function saveGame(game: Game, previousVersion: number) {
  game.version = previousVersion + 1;
  const [saved] = await db.tx.update(GAMES, [{ id: game.code, record: game, if: { version: previousVersion } }]);
  if (!saved) throw new Error('The game changed; refresh and try again');
}

async function notify(code: string, game: Game) {
  const page = await db.list<{ code: string; connectionId: string }>(SUBSCRIPTIONS, { filter: { code }, limit: 100 });
  const ids = page.items.map((item) => item.connectionId);
  if (ids.length) await ws.send(ids, { type: 'entity.update', entity_type: 'game', entity_id: code, data: publicGame(game) });
}

async function runBots(game: Game) {
  let guard = 0;
  while (game.status === 'playing' && game.players[game.turnIndex]?.bot && guard < 8) {
    const bot = game.players[game.turnIndex];
    applyMove(game, bot, legalBotMove(game, bot));
    guard += 1;
  }
}

function withFailure(message: unknown) {
  return error(message instanceof Error ? message.message : 'Request failed', 400);
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'GET /api/docs': [async () => json({
    title: 'Signal Isles Agent API',
    flow: ['POST /api/games', 'POST /api/games/:code/join', 'POST /api/games/:code/start', 'GET /api/games/:code', 'POST /api/games/:code/move'],
    actions: {
      charge: { body: { playerToken: '...', action: 'charge' }, note: 'Gain 2 energy.' },
      claim: { body: { playerToken: '...', action: 'claim', target: 5 }, note: 'Spend 1 energy to claim adjacent neutral target 0-15.' },
      fortify: { body: { playerToken: '...', action: 'fortify', target: 5 }, note: 'Spend 1 energy to add shield, max 2.' },
      raid: { body: { playerToken: '...', action: 'raid', target: 5, spend: 3 }, note: 'Commit 1-3 energy; capture if spend exceeds shield + 1.' },
    },
  })],
  'POST /api/games': [async ({ body }) => {
    try {
      const input = body as { name?: string; bots?: number };
      const code = randomCode();
      const creator: Player = { id: 'p1', name: cleanName(input.name), token: randomToken(), bot: false, energy: 3 };
      const game: Game = {
        id: code,
        code,
        status: 'lobby',
        players: [creator],
        cells: Array.from({ length: BOARD_SIZE }, () => ({ owner: null, shield: 0 })),
        turnIndex: 0,
        turnCount: 0,
        maxTurns: 28,
        winnerId: null,
        log: [{ turn: 0, actor: 'System', text: `${creator.name} opened lobby ${code}.` }],
        version: 1,
        createdAt: new Date().toISOString(),
      };
      const botCount = Math.max(0, Math.min(3, Number(input.bots) || 0));
      for (let index = 0; index < botCount; index += 1) {
        game.players.push({ id: `p${game.players.length + 1}`, name: `Bot ${String.fromCharCode(65 + index)}`, token: randomToken(), bot: true, energy: 3 });
      }
      const [created] = await db.tx.add(GAMES, [game]);
      if (!created) throw new Error('Could not create lobby; try again');
      return json({ game: publicGame(game), playerToken: creator.token, playerId: creator.id }, 201);
    } catch (caught) {
      return withFailure(caught);
    }
  }],
  'GET /api/games/:code': [async ({ params }) => {
    const game = await loadGame(params.code);
    if (!game) return error('Lobby not found', 404);
    return json({ game: publicGame(game), standings: summarize(game) });
  }],
  'POST /api/games/:code/join': [async ({ params, body }) => {
    try {
      const game = await loadGame(params.code);
      if (!game) return error('Lobby not found', 404);
      if (game.status !== 'lobby') throw new Error('This match has already started');
      if (game.players.length >= 4) throw new Error('Lobby is full');
      const input = body as { name?: string };
      const player: Player = { id: `p${game.players.length + 1}`, name: cleanName(input.name), token: randomToken(), bot: false, energy: 3 };
      const version = game.version;
      game.players.push(player);
      game.log.push({ turn: 0, actor: 'System', text: `${player.name} joined the lobby.` });
      await saveGame(game, version);
      await notify(game.code, game);
      return json({ game: publicGame(game), playerToken: player.token, playerId: player.id });
    } catch (caught) {
      return withFailure(caught);
    }
  }],
  'POST /api/games/:code/fill-bots': [async ({ params, body }) => {
    try {
      const game = await loadGame(params.code);
      if (!game) return error('Lobby not found', 404);
      const input = body as { playerToken?: string };
      if (!game.players.some((player) => player.token === input.playerToken && !player.bot)) throw new Error('Player token required');
      if (game.status !== 'lobby') throw new Error('Game already started');
      const version = game.version;
      while (game.players.length < 4) {
        const number = game.players.filter((player) => player.bot).length + 1;
        game.players.push({ id: `p${game.players.length + 1}`, name: `Bot ${String.fromCharCode(64 + number)}`, token: randomToken(), bot: true, energy: 3 });
      }
      game.log.push({ turn: 0, actor: 'System', text: 'Empty seats filled with tide bots.' });
      await saveGame(game, version);
      await notify(game.code, game);
      return json({ game: publicGame(game) });
    } catch (caught) {
      return withFailure(caught);
    }
  }],
  'POST /api/games/:code/start': [async ({ params, body }) => {
    try {
      const game = await loadGame(params.code);
      if (!game) return error('Lobby not found', 404);
      const input = body as { playerToken?: string };
      if (game.players[0]?.token !== input.playerToken) throw new Error('Only the lobby creator can start');
      if (game.status !== 'lobby') throw new Error('Game already started');
      if (game.players.length < 2) throw new Error('Add another player or fill bot seats first');
      const version = game.version;
      game.status = 'playing';
      game.players.forEach((player, index) => { game.cells[STARTS[index]] = { owner: player.id, shield: 1 }; });
      game.log.push({ turn: 0, actor: 'System', text: 'The signal storm begins.' });
      await runBots(game);
      await saveGame(game, version);
      await notify(game.code, game);
      return json({ game: publicGame(game), standings: summarize(game) });
    } catch (caught) {
      return withFailure(caught);
    }
  }],
  'POST /api/games/:code/move': [async ({ params, body }) => {
    try {
      const game = await loadGame(params.code);
      if (!game) return error('Lobby not found', 404);
      const input = body as Move & { playerToken?: string };
      const player = game.players.find((candidate) => candidate.token === input.playerToken && !candidate.bot);
      if (!player) throw new Error('Valid human player token required');
      const version = game.version;
      applyMove(game, player, input);
      await runBots(game);
      await saveGame(game, version);
      await notify(game.code, game);
      return json({ game: publicGame(game), standings: summarize(game) });
    } catch (caught) {
      return withFailure(caught);
    }
  }],
  'GET /api/games/:code/replay': [async ({ params }) => {
    const game = await loadGame(params.code);
    if (!game) return error('Lobby not found', 404);
    return json({ code: game.code, status: game.status, winnerId: game.winnerId, log: game.log, standings: summarize(game) });
  }],
  'POST /api/subscriptions': [async ({ body }) => {
    const input = body as { connection_id?: string; entity_type?: string; entity_id?: string };
    if (!input.connection_id || input.entity_type !== 'game' || !input.entity_id) return error('Invalid subscription', 400);
    const id = crypto.randomUUID();
    await db.tx.add(SUBSCRIPTIONS, [{ id, code: input.entity_id.toUpperCase(), connectionId: input.connection_id }]);
    return json({ subscribed: true, subscriptionId: id });
  }],
  'DELETE /api/subscriptions/:id': [async ({ params }) => {
    await db.delete(SUBSCRIPTIONS, [params.id]);
    return json({ unsubscribed: true });
  }],
});

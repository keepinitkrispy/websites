const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) throw new Error('Usage: node sample-bot.mjs https://your-game-url');

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function adjacent(a, b) {
  return Math.abs((a % 4) - (b % 4)) + Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) === 1;
}

function choose(game, playerId) {
  const me = game.players.find((player) => player.id === playerId);
  const owned = game.cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell.owner === playerId);
  const frontier = game.cells.map((cell, index) => ({ cell, index })).filter(({ index }) => owned.some((home) => adjacent(home.index, index)));
  const neutral = frontier.find(({ cell }) => cell.owner === null);
  if (neutral && me.energy >= 1) return { action: 'claim', target: neutral.index };
  const weakEnemy = frontier.find(({ cell }) => cell.owner && cell.owner !== playerId && me.energy >= cell.shield + 2);
  if (weakEnemy) return { action: 'raid', target: weakEnemy.index, spend: Math.min(3, weakEnemy.cell.shield + 2) };
  return { action: 'charge' };
}

const created = await request('/api/games', { method: 'POST', body: { name: 'Sample Agent', bots: 0 } });
const { code } = created.game;
const { playerToken, playerId } = created;
await request(`/api/games/${code}/fill-bots`, { method: 'POST', body: { playerToken } });
await request(`/api/games/${code}/start`, { method: 'POST', body: { playerToken } });
console.log(`Playing match ${code}`);

while (true) {
  const state = await request(`/api/games/${code}`);
  if (state.game.status === 'finished') {
    console.log(state.standings);
    break;
  }
  if (state.game.players[state.game.turnIndex].id !== playerId) continue;
  const move = choose(state.game, playerId);
  await request(`/api/games/${code}/move`, { method: 'POST', body: { playerToken, ...move } });
  console.log(move);
}

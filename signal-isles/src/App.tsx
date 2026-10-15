import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ws, type WsConnection } from '@appdeploy/client';
import { Bot, Copy, Play, Radio, RefreshCw, Swords, Users } from 'lucide-react';

type Player = { id: string; name: string; bot: boolean; energy: number };
type Cell = { owner: string | null; shield: number };
type LogEntry = { turn: number; actor: string; text: string };
type Game = {
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  players: Player[];
  cells: Cell[];
  turnIndex: number;
  turnCount: number;
  maxTurns: number;
  winnerId: string | null;
  log: LogEntry[];
};
type Action = 'charge' | 'claim' | 'raid' | 'fortify';

const colors = ['#6ee7ff', '#ff7a90', '#ffd166', '#9cff8a'];

function App() {
  const [name, setName] = useState('Captain');
  const [joinCode, setJoinCode] = useState('');
  const [bots, setBots] = useState(1);
  const [game, setGame] = useState<Game | null>(null);
  const [playerToken, setPlayerToken] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [action, setAction] = useState<Action>('claim');
  const [spend, setSpend] = useState(2);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const connectionRef = useRef<WsConnection | null>(null);
  const subscriptionRef = useRef<string | null>(null);

  const me = game?.players.find((player) => player.id === playerId);
  const current = game?.players[game.turnIndex];
  const winner = game?.players.find((player) => player.id === game.winnerId);
  const standings = useMemo(() => {
    if (!game) return [];
    return game.players.map((player) => ({
      ...player,
      cells: game.cells.filter((cell) => cell.owner === player.id).length,
    })).sort((a, b) => b.cells - a.cells || b.energy - a.energy);
  }, [game]);

  useEffect(() => {
    const connection = ws.connect();
    connectionRef.current = connection;
    connection.onMessage((event) => {
      if (event?.type === 'entity.update' && event.entity_type === 'game') setGame(event.data as Game);
    });
    return () => connection.disconnect();
  }, []);

  useEffect(() => {
    const connection = connectionRef.current;
    if (!connection || !game?.code) return;
    let active = true;
    connection.ready.then(async () => {
      if (!active || !connection.connectionId) return;
      const response = await api.post('/api/subscriptions', {
        connection_id: connection.connectionId,
        entity_type: 'game',
        entity_id: game.code,
      });
      subscriptionRef.current = response.data.subscriptionId;
    });
    return () => {
      active = false;
      const id = subscriptionRef.current;
      if (id) void api.delete(`/api/subscriptions/${id}`);
      subscriptionRef.current = null;
    };
  }, [game?.code]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (caught) {
      const failure = caught as { response?: { data?: { error?: string } }; message?: string };
      setMessage(failure.response?.data?.error ?? failure.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function enter(response: { data: { game: Game; playerToken: string; playerId: string } }) {
    setGame(response.data.game);
    setPlayerToken(response.data.playerToken);
    setPlayerId(response.data.playerId);
  }

  const create = () => run(async () => enter(await api.post('/api/games', { name, bots })));
  const join = () => run(async () => enter(await api.post(`/api/games/${joinCode.trim().toUpperCase()}/join`, { name })));
  const refresh = () => run(async () => setGame((await api.get(`/api/games/${game?.code}`)).data.game));
  const fillBots = () => run(async () => setGame((await api.post(`/api/games/${game?.code}/fill-bots`, { playerToken })).data.game));
  const start = () => run(async () => setGame((await api.post(`/api/games/${game?.code}/start`, { playerToken })).data.game));

  const move = (target?: number) => run(async () => {
    const payload = { playerToken, action, target, spend };
    setGame((await api.post(`/api/games/${game?.code}/move`, payload)).data.game);
  });

  if (!game) {
    return (
      <main className="landing">
        <section className="hero">
          <div className="eyebrow"><Radio size={16} /> HUMAN + AGENT STRATEGY</div>
          <h1>Signal Isles</h1>
          <p>Claim a shifting archipelago, bank energy, bluff your raids, and lock down the signal before rivals do.</p>
        </section>
        <section className="entry-card">
          <label>Call sign<input value={name} onChange={(event) => setName(event.target.value)} maxLength={20} /></label>
          <div className="create-row">
            <label>Starting bots<select value={bots} onChange={(event) => setBots(Number(event.target.value))}><option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
            <button className="primary" onClick={create} disabled={busy}><Play size={18} /> Create match</button>
          </div>
          <div className="divider"><span>or join by code</span></div>
          <div className="join-row"><input aria-label="Match code" placeholder="ABCDE" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={5} /><button onClick={join} disabled={busy || joinCode.length < 5}>Join</button></div>
          {message && <p className="error">{message}</p>}
          <a className="api-link" href="#api" onClick={(event) => { event.preventDefault(); window.open('./api/docs', '_blank'); }}>Agent API →</a>
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header>
        <div><div className="eyebrow">SIGNAL ISLES</div><h2>{game.status === 'lobby' ? 'Assemble your fleet' : game.status === 'finished' ? `${winner?.name ?? 'A strategist'} wins` : `${current?.name}'s turn`}</h2></div>
        <div className="code" onClick={() => void navigator.clipboard.writeText(game.code)}><span>MATCH</span>{game.code}<Copy size={16} /></div>
      </header>

      {game.status === 'lobby' ? (
        <section className="lobby-panel">
          <div className="roster">
            {game.players.map((player, index) => <div className="roster-item" key={player.id}><span className="dot" style={{ background: colors[index] }} />{player.bot ? <Bot size={17} /> : <Users size={17} />}{player.name}</div>)}
            {Array.from({ length: 4 - game.players.length }, (_, index) => <div className="roster-item empty" key={index}>Open seat</div>)}
          </div>
          <div className="lobby-actions"><button onClick={fillBots} disabled={busy || game.players.length === 4}><Bot size={18} /> Fill with bots</button>{playerId === 'p1' && <button className="primary" onClick={start} disabled={busy || game.players.length < 2}><Swords size={18} /> Start match</button>}<button className="ghost" onClick={refresh}><RefreshCw size={17} /> Refresh</button></div>
          <p>Share code <strong>{game.code}</strong>. No login required. Two to four humans and bots can play together.</p>
          {message && <p className="error">{message}</p>}
        </section>
      ) : (
        <div className="game-grid">
          <section className="board-card">
            <div className="board">
              {game.cells.map((cell, index) => {
                const ownerIndex = game.players.findIndex((player) => player.id === cell.owner);
                return <button key={index} className={`cell ${cell.owner ? 'owned' : ''}`} style={{ '--owner': ownerIndex >= 0 ? colors[ownerIndex] : '#1d2b3c' } as React.CSSProperties} onClick={() => game.status === 'playing' && action !== 'charge' && void move(index)} disabled={busy || current?.id !== playerId || game.status !== 'playing'}><span>{index + 1}</span>{cell.shield > 0 && <b>{'◆'.repeat(cell.shield)}</b>}</button>;
              })}
            </div>
            <div className="turn-meter"><span>Turn {game.turnCount} / {game.maxTurns}</span><div><i style={{ width: `${Math.min(100, (game.turnCount / game.maxTurns) * 100)}%` }} /></div></div>
          </section>

          <aside>
            <section className="standings">
              {standings.map((player) => {
                const index = game.players.findIndex((item) => item.id === player.id);
                return <div className={player.id === current?.id ? 'active player-row' : 'player-row'} key={player.id}><span className="dot" style={{ background: colors[index] }} /><div><strong>{player.name}{player.id === playerId ? ' (you)' : ''}</strong><small>{player.cells} islands · {player.energy} energy</small></div></div>;
              })}
            </section>
            {game.status === 'playing' && <section className="actions"><h3>Your command</h3><div className="action-tabs">{(['claim', 'raid', 'fortify', 'charge'] as Action[]).map((item) => <button key={item} className={action === item ? 'selected' : ''} onClick={() => setAction(item)}>{item}</button>)}</div>{action === 'raid' && <label className="spend">Raid power<select value={spend} onChange={(event) => setSpend(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>}<p>{action === 'charge' ? 'Gain 2 energy. No island target needed.' : 'Choose an eligible island on the grid.'}</p>{action === 'charge' && <button className="primary full" onClick={() => void move()} disabled={busy || current?.id !== playerId}>Charge tide</button>}<small>{current?.id === playerId ? 'Your turn — make it count.' : `Waiting for ${current?.name}.`}</small></section>}
            <section className="log"><h3>Match signal</h3>{game.log.slice(-7).reverse().map((entry, index) => <p key={`${entry.turn}-${index}`}>{entry.text}</p>)}</section>
            {message && <p className="error">{message}</p>}
          </aside>
        </div>
      )}
      <footer><button className="ghost" onClick={() => { setGame(null); setPlayerId(''); setPlayerToken(''); }}>Leave match</button><a href="#api" onClick={(event) => { event.preventDefault(); window.open('./api/docs', '_blank'); }}>Agent API</a><span>First to 8 islands, or lead after 28 turns.</span></footer>
    </main>
  );
}

export default App;

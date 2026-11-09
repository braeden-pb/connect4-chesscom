import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createGame, getGame, makeMove, type GameState } from './api';
import { findWinningLine } from './winningLine.mjs';

const STORAGE_KEY = 'connect4.gameId';
const playerName = (player: number) => player === 1 ? 'Red' : 'Yellow';
function playTone(context: AudioContext, frequency: number, endFrequency: number, delay: number, duration: number, volume: number) {
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}
function description(game: GameState): string {
  if (game.status === 'won') return `${playerName(game.winner)} wins!`;
  if (game.status === 'draw') return "It's a draw!";
  return `${playerName(game.turn)} to move`;
}
export default function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<number | null>(null);
  const [lastDrop, setLastDrop] = useState<{ row: number; column: number; gameId: string; move: number } | null>(null);
  const operation = useRef(false);
  const requestVersion = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);

  const enableAudio = () => {
    if (typeof window === 'undefined' || !window.AudioContext) return null;
    audioContext.current ??= new window.AudioContext();
    if (audioContext.current.state === 'suspended') {
      void audioContext.current.resume().catch(error => console.error('Could not enable game sounds.', error));
    }
    return audioContext.current;
  };

  const newGame = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError('');
    const version = ++requestVersion.current;
    try {
      const fresh = await createGame();
      if (version !== requestVersion.current) return;
      localStorage.setItem(STORAGE_KEY, fresh.id);
      setLastDrop(null);
      setCelebration(null);
      setGame(fresh);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create a game.'); }
    finally { operation.current = false; setBusy(false); setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const id = localStorage.getItem(STORAGE_KEY);
      if (!id) { setLoading(false); await newGame(); return; }
      try {
        const existing = await getGame(id);
        if (active) setGame(existing);
      } catch (e) {
        if (active) {
          if (e instanceof ApiError && e.status === 404) {
            localStorage.removeItem(STORAGE_KEY);
            await newGame();
          } else setError(e instanceof Error ? e.message : 'Could not load game.');
        }
      } finally { if (active) setLoading(false); }
    };
    void init();
    return () => { active = false; };
  }, [newGame]);

  const drop = async (column: number) => {
    if (!game || game.status !== 'in_progress' || busy || operation.current || game.board[0][column] !== 0) return;
    const sound = enableAudio();
    operation.current = true; setBusy(true); setError('');
    try {
      const updated = await makeMove(game.id, column);
      const row = updated.board.findIndex((cells, index) => cells[column] !== game.board[index][column]);
      setLastDrop(row >= 0 ? { row, column, gameId: updated.id, move: updated.moves } : null);
      setGame(updated);
      if (sound) {
        playTone(sound, 520, 210, 0, 0.18, 0.045);
        if (updated.status === 'won') {
          playTone(sound, 523.25, 523.25, 0.12, 0.3, 0.035);
          playTone(sound, 659.25, 659.25, 0.18, 0.3, 0.035);
          playTone(sound, 783.99, 783.99, 0.24, 0.42, 0.035);
        }
      }
      if (updated.status === 'won') setCelebration(updated.moves);
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed.');
      if (e instanceof ApiError && (e.status === 409 || e.status === 400)) {
        try { setGame(await getGame(game.id)); } catch { /* Keep last known board. */ }
      }
    } finally { operation.current = false; setBusy(false); }
  };

  const isFinished = game?.status !== 'in_progress';
  const winningLine = game?.status === 'won' ? findWinningLine(game.board, game.winner) : [];
  const winningCells = new Set(winningLine.map(([row, col]) => `${row}-${col}`));
  return <main className="app-shell">
    {celebration !== null && game?.status === 'won' && <div key={`${game.id}-${celebration}`} className="victory-fireworks" aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) setCelebration(null); }}>
      {Array.from({ length: 3 }, (_, burst) => <div className={`firework-burst firework-burst-${burst + 1}`} key={burst}>
        {Array.from({ length: 12 }, (_, particle) => <i key={particle} className="firework-particle" style={{ '--angle': `${particle * 30}deg`, '--distance': `${68 + (particle % 3) * 15}px` } as React.CSSProperties} />)}
      </div>)}
    </div>}
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><span>FOUR<span className="brand-light">INAROW</span></span></div>
      <span className="top-label">THE CLASSIC STRATEGY GAME</span>
    </header>
    <section className="layout">
      <div className="intro"><div className="eyebrow"><span className="eyebrow-dot"/> TWO PLAYERS · ONE WINNER</div><h1>Make your <em>move.</em></h1><p>Connect four discs in a row — vertically, horizontally, or diagonally — to claim victory.</p></div>
      <div className="game-panel">
        <div className="panel-heading"><div><span className="overline">CURRENT MATCH</span><h2>Connect Four</h2></div><span className="match-badge">LOCAL · 2 PLAYERS</span></div>
        <div className="players">
          <div className={`player-card red ${game?.status === 'in_progress' && game.turn === 1 ? 'active' : ''} ${game?.winner === 1 ? 'champion' : ''}`}><span className="player-disc"/><div><span className="player-caption">PLAYER ONE</span><strong>Red</strong></div>{game?.turn === 1 && game.status === 'in_progress' && <span className="playing">PLAYING</span>}{game?.winner === 1 && <span className="playing">WINNER</span>}</div>
          <span className="versus">VS</span>
          <div className={`player-card yellow ${game?.status === 'in_progress' && game.turn === 2 ? 'active' : ''} ${game?.winner === 2 ? 'champion' : ''}`}><span className="player-disc"/><div><span className="player-caption">PLAYER TWO</span><strong>Yellow</strong></div>{game?.turn === 2 && game.status === 'in_progress' && <span className="playing">PLAYING</span>}{game?.winner === 2 && <span className="playing">WINNER</span>}</div>
        </div>
        <div className={`status ${game?.status === 'won' ? 'status-win' : ''}`} role="status" aria-live="polite"><span className={`status-indicator ${game?.status === 'in_progress' ? game.turn === 1 ? 'red-dot' : 'yellow-dot' : ''}`}/><span>{loading ? 'Loading your match…' : game ? description(game) : 'Ready to play?'}</span><span className="move-counter">{game?.moves ?? 0} / 42 MOVES</span></div>
        <div className="board-wrap"><div className="board" role="group" aria-label="Connect Four game board">
          {Array.from({length:7}, (_, col) => <button type="button" className="board-column" key={col} onMouseEnter={() => setHovered(col)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(col)} onBlur={() => setHovered(null)} onClick={() => void drop(col)} disabled={!game || busy || isFinished || game.board[0][col] !== 0} aria-label={`Drop ${game ? playerName(game.turn) : 'a'} disc in column ${col + 1}`}>
            {Array.from({length:6}, (_, row) => { const cell = game?.board[row][col] ?? 0; const winning = winningCells.has(`${row}-${col}`);
              const justDropped = !!cell && lastDrop !== null && game !== null && lastDrop.gameId === game.id && lastDrop.move === game.moves && lastDrop.row === row && lastDrop.column === col;
              return <span className={`slot ${winning ? 'slot-winning' : ''} ${hovered === col && row === 0 && !cell && !busy && !isFinished ? `slot-preview-${game?.turn}` : ''}`} key={`${row}-${col}-${justDropped ? game?.moves : 0}`} aria-label={`Row ${row + 1}, column ${col + 1}: ${cell ? playerName(cell) : 'empty'}${winning ? ', winning piece' : ''}`}>{cell !== 0 && <span className={`disc-piece ${cell === 1 ? 'slot-red' : 'slot-yellow'} ${justDropped ? 'disc-dropping' : ''}`} style={justDropped ? { '--drop-rows': row + 1, '--drop-duration': `${450 + (row + 1) * 85}ms` } as React.CSSProperties : undefined}><span className="disc-shine"/></span>}</span>; })}
          </button>)}
        </div></div>
        <div className="below-board"><span className="hint">↓ Select any column to drop your disc</span><button type="button" className="new-game" onClick={() => void newGame()} disabled={busy}><span aria-hidden="true">↻</span> New game</button></div>
        {error && <div className="error" role="alert">{error} <button type="button" onClick={() => { setError(''); if (game) void getGame(game.id).then(setGame).catch(e => setError(String(e))); else void newGame(); }}>Retry</button></div>}
      </div>
      <div className="footnote"><span>HOW TO PLAY</span> Take turns dropping discs into the board. First to connect four wins. A full board without a winner is a draw.</div>
    </section>
    <footer>BUILT FOR THE LOVE OF THE GAME <span>·</span> CONNECT FOUR</footer>
  </main>;
}

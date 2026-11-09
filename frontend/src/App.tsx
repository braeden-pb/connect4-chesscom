import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createGame, getGame, makeMove, type GameState } from './api';
import { findWinningLine } from './winningLine.mjs';

const STORAGE_KEY = 'connect4.gameId';
const playerName = (player: number) => player === 1 ? 'Red' : 'Yellow';
const musicTracks = {
  arcade: {
    label: 'Arcade',
    notes: [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 587.33, 783.99, 440, 554.37, 659.25, 880, 783.99, 659.25, 587.33, 523.25],
    bass: [130.81, 146.83, 110, 130.81],
    interval: 180,
    noteDuration: 0.15,
    noteWave: 'square' as OscillatorType,
  },
  retro: {
    label: 'Retro Lo-fi',
    notes: [196, 233.08, 293.66, 349.23, 293.66, 233.08, 174.61, 220, 261.63, 349.23, 261.63, 220, 164.81, 196, 246.94, 293.66],
    bass: [82.41, 98, 73.42, 87.31],
    interval: 320,
    noteDuration: 0.3,
    noteWave: 'triangle' as OscillatorType,
  },
  chill: {
    label: 'Chill',
    notes: [261.63, 329.63, 392, 493.88, 392, 329.63, 293.66, 349.23, 440, 523.25, 440, 349.23, 246.94, 293.66, 369.99, 440],
    bass: [130.81, 110, 146.83, 123.47],
    interval: 320,
    noteDuration: 0.38,
    noteWave: 'triangle' as OscillatorType,
  },
} as const;
type MusicTrack = keyof typeof musicTracks;
function isMusicTrack(value: string): value is MusicTrack {
  return Object.prototype.hasOwnProperty.call(musicTracks, value);
}
function playTone(context: AudioContext, frequency: number, endFrequency: number, delay: number, duration: number, volume: number, destination: AudioNode = context.destination, type: OscillatorType = 'sine') {
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(destination);
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
  const [musicOn, setMusicOn] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.35);
  const [musicTrack, setMusicTrack] = useState<MusicTrack>('arcade');
  const [effectsOn, setEffectsOn] = useState(true);
  const [effectsVolume, setEffectsVolume] = useState(0.65);
  const operation = useRef(false);
  const requestVersion = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const effectsGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    if (celebration === null) return;
    const timeout = window.setTimeout(() => setCelebration(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [celebration]);

  useEffect(() => {
    if (!musicOn) return;
    const context = enableAudio();
    if (!context) return;

    let active = true;
    let timeout: number | undefined;
    let step = 0;
    const track = musicTracks[musicTrack];
    const musicGain = context.createGain();
    musicGain.gain.setValueAtTime(0.0001, context.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, musicVolume), context.currentTime + 0.25);
    musicGain.connect(context.destination);
    musicGainRef.current = musicGain;

    const playNextNote = () => {
      if (!active) return;
      playTone(context, track.notes[step], track.notes[step], 0, track.noteDuration, 0.075, musicGain, track.noteWave);
      if (step % 4 === 0) {
        const bassNote = track.bass[Math.floor(step / 4) % track.bass.length];
        playTone(context, bassNote, bassNote, 0, track.noteDuration * 1.8, 0.11, musicGain, 'triangle');
      }
      step = (step + 1) % track.notes.length;
      timeout = window.setTimeout(playNextNote, track.interval);
    };

    void context.resume().then(playNextNote).catch(error => {
      console.error('Could not start background music.', error);
    });

    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
      musicGainRef.current = null;
      const now = context.currentTime;
      musicGain.gain.cancelScheduledValues(now);
      musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0.0001), now);
      musicGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      window.setTimeout(() => musicGain.disconnect(), 200);
    };
  }, [musicOn, musicTrack]);

  useEffect(() => {
    const gain = musicGainRef.current;
    if (!gain || !audioContext.current) return;
    const now = audioContext.current.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(Math.max(0.0001, musicVolume), now, 0.06);
  }, [musicVolume, musicOn]);

  useEffect(() => {
    const gain = effectsGainRef.current;
    if (!gain || !audioContext.current) return;
    gain.gain.setTargetAtTime(Math.max(0.0001, effectsVolume), audioContext.current.currentTime, 0.015);
  }, [effectsVolume]);

  const enableAudio = () => {
    if (typeof window === 'undefined' || !window.AudioContext) return null;
    audioContext.current ??= new window.AudioContext();
    if (audioContext.current.state === 'suspended') {
      void audioContext.current.resume().catch(error => console.error('Could not enable game sounds.', error));
    }
    return audioContext.current;
  };

  const getEffectsOutput = (context: AudioContext) => {
    let gain = effectsGainRef.current;
    if (!gain) {
      gain = context.createGain();
      gain.connect(context.destination);
      effectsGainRef.current = gain;
    }
    gain.gain.setTargetAtTime(Math.max(0.0001, effectsVolume), context.currentTime, 0.015);
    return gain;
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
    const sound = effectsOn ? enableAudio() : null;
    const effectsOutput = sound ? getEffectsOutput(sound) : null;
    operation.current = true; setBusy(true); setError('');
    try {
      const updated = await makeMove(game.id, column);
      const row = updated.board.findIndex((cells, index) => cells[column] !== game.board[index][column]);
      setLastDrop(row >= 0 ? { row, column, gameId: updated.id, move: updated.moves } : null);
      setGame(updated);
      if (sound) {
        playTone(sound, 520, 210, 0, 0.18, 0.045, effectsOutput ?? sound.destination);
        if (updated.status === 'won') {
          playTone(sound, 523.25, 523.25, 0.12, 0.3, 0.035, effectsOutput ?? sound.destination);
          playTone(sound, 659.25, 659.25, 0.18, 0.3, 0.035, effectsOutput ?? sound.destination);
          playTone(sound, 783.99, 783.99, 0.24, 0.42, 0.035, effectsOutput ?? sound.destination);
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
    {celebration !== null && game?.status === 'won' && <div key={`${game.id}-${celebration}`} className="victory-fireworks" aria-hidden="true">
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
        <details className="audio-menu">
          <summary className={`audio-menu-trigger ${musicOn || effectsOn ? 'audio-menu-active' : ''}`} aria-label="Open audio settings" title="Audio settings">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11"/></svg>
          </summary>
          <div className="audio-popover" aria-label="Audio settings">
            <div className="audio-setting">
              <button type="button" className={`audio-setting-toggle ${musicOn ? 'audio-setting-on' : ''}`} aria-pressed={musicOn} onClick={() => setMusicOn(value => !value)}>
                <span className="audio-setting-icon" aria-hidden="true">♫</span><span>Arcade music</span><span className="audio-switch" aria-hidden="true"/>
              </button>
              <label className="audio-volume"><span>Music volume</span><input type="range" min="0" max="1" step="0.05" value={musicVolume} aria-label="Music volume" onChange={event => setMusicVolume(Number(event.target.value))}/></label>
              <label className="music-track-control"><span>Music style</span><select aria-label="Music style" value={musicTrack} onChange={event => { if (isMusicTrack(event.target.value)) setMusicTrack(event.target.value); }}>
                {Object.entries(musicTracks).map(([track, details]) => <option value={track} key={track}>{details.label}</option>)}
              </select></label>
            </div>
            <div className="audio-setting">
              <button type="button" className={`audio-setting-toggle ${effectsOn ? 'audio-setting-on' : ''}`} aria-pressed={effectsOn} onClick={() => setEffectsOn(value => !value)}>
                <span className="audio-setting-icon" aria-hidden="true">●</span><span>Game sounds</span><span className="audio-switch" aria-hidden="true"/>
              </button>
              <label className="audio-volume"><span>Sound volume</span><input type="range" min="0" max="1" step="0.05" value={effectsVolume} aria-label="Sound effects volume" onChange={event => setEffectsVolume(Number(event.target.value))}/></label>
            </div>
          </div>
        </details>
        <div className="board-wrap"><div className="board" role="group" aria-label="Connect Four game board">
          {Array.from({length:7}, (_, col) => <button type="button" className="board-column" key={col} onMouseEnter={() => setHovered(col)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(col)} onBlur={() => setHovered(null)} onClick={() => void drop(col)} disabled={!game || busy || isFinished || game.board[0][col] !== 0} aria-label={`Drop ${game ? playerName(game.turn) : 'a'} disc in column ${col + 1}`}>
            {Array.from({length:6}, (_, row) => { const cell = game?.board[row][col] ?? 0; const winning = winningCells.has(`${row}-${col}`);
              const justDropped = !!cell && lastDrop !== null && game !== null && lastDrop.gameId === game.id && lastDrop.move === game.moves && lastDrop.row === row && lastDrop.column === col;
              return <span className={`slot ${winning ? 'slot-winning' : ''} ${hovered === col && row === 0 && !cell && !busy && !isFinished ? `slot-preview-${game?.turn}` : ''}`} key={`${row}-${col}-${justDropped ? game?.moves : 0}`} aria-label={`Row ${row + 1}, column ${col + 1}: ${cell ? playerName(cell) : 'empty'}${winning ? ', winning piece' : ''}`}>{cell !== 0 && <span className={`disc-piece ${cell === 1 ? 'slot-red' : 'slot-yellow'} ${justDropped ? 'disc-dropping' : ''}`} style={justDropped ? { '--drop-rows': row + 1, '--drop-duration': `${450 + (row + 1) * 85}ms` } as React.CSSProperties : undefined}><span className="disc-shine"/></span>}</span>; })}
          </button>)}
        </div>
        {celebration !== null && game?.status === 'won' && <div key={`${game.id}-${celebration}-winner`} className={`winner-overlay winner-overlay-${game.winner}`} role="status" aria-live="polite">
          <span className="winner-overlay-disc" aria-hidden="true"/>
          <span><span className="winner-overlay-label">VICTORY</span><strong>{playerName(game.winner)} team wins!</strong></span>
          <span className="winner-overlay-mark" aria-hidden="true">★</span>
        </div>}</div>
        <div className="below-board"><span className="hint">↓ Select any column to drop your disc</span><button type="button" className="new-game" onClick={() => void newGame()} disabled={busy}><span aria-hidden="true">↻</span> New game</button></div>
        {error && <div className="error" role="alert">{error} <button type="button" onClick={() => { setError(''); if (game) void getGame(game.id).then(setGame).catch(e => setError(String(e))); else void newGame(); }}>Retry</button></div>}
      </div>
      <div className="footnote"><span>HOW TO PLAY</span> Take turns dropping discs into the board. First to connect four wins. A full board without a winner is a draw.</div>
    </section>
    <footer>BUILT FOR THE LOVE OF THE GAME <span>·</span> CONNECT FOUR</footer>
  </main>;
}

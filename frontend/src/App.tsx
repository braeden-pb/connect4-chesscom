import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, createGame, createOnlineGame, getGame, joinGame, makeMove, type GameState } from './api';
import { findWinningLine } from './winningLine.mjs';

const STORAGE_KEY = 'connect4.gameId';
const BACKGROUND_STORAGE_KEY = 'connect4.backgroundTheme';
const SCORE_STORAGE_KEY = 'connect4.matchScoreboard';
const ONLINE_TOKENS_KEY = 'connect4.onlineTokens';
type OnlinePlayer = 1 | 2;
type OnlineTokenMap = Record<string, { token: string; player: OnlinePlayer }>;
const backgroundThemes = [
  { id: 'classic', label: 'Classic', description: 'Midnight blue' },
  { id: 'neon', label: 'Neon Grid', description: 'Electric purple and cyan' },
  { id: 'retro', label: 'Retro Sunset', description: 'Warm arcade colors' },
] as const;
type BackgroundTheme = typeof backgroundThemes[number]['id'];
function readOnlineTokens(): OnlineTokenMap {
  const stored = localStorage.getItem(ONLINE_TOKENS_KEY);
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, { token: string; player: OnlinePlayer }] => {
      const value = entry[1];
      return !!value && typeof value === 'object' && 'token' in value && typeof value.token === 'string'
        && 'player' in value && (value.player === 1 || value.player === 2);
    }));
  } catch {
    return {};
  }
}
type Scoreboard = { red: number; yellow: number };
function readScoreboard(): Scoreboard {
  const stored = localStorage.getItem(SCORE_STORAGE_KEY);
  if (!stored) return { red: 0, yellow: 0 };
  try {
    const parsed: unknown = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && 'red' in parsed && 'yellow' in parsed
      && typeof parsed.red === 'number' && typeof parsed.yellow === 'number'
      && Number.isSafeInteger(parsed.red) && Number.isSafeInteger(parsed.yellow)
      && parsed.red >= 0 && parsed.yellow >= 0) {
      return { red: parsed.red, yellow: parsed.yellow };
    }
  } catch {
    return { red: 0, yellow: 0 };
  }
  return { red: 0, yellow: 0 };
}
function isBackgroundTheme(value: string | null): value is BackgroundTheme {
  return backgroundThemes.some(theme => theme.id === value);
}
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
  const [focusedColumn, setFocusedColumn] = useState(3);
  const [scoreboard, setScoreboard] = useState<Scoreboard>(readScoreboard);
  const [onlinePlayer, setOnlinePlayer] = useState<OnlinePlayer | null>(null);
  const [onlineToken, setOnlineToken] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [celebration, setCelebration] = useState<number | null>(null);
  const [lastDrop, setLastDrop] = useState<{ row: number; column: number; gameId: string; move: number } | null>(null);
  const [musicOn, setMusicOn] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.35);
  const [musicTrack, setMusicTrack] = useState<MusicTrack>('arcade');
  const [effectsOn, setEffectsOn] = useState(true);
  const [effectsVolume, setEffectsVolume] = useState(0.65);
  const [backgroundTheme, setBackgroundTheme] = useState<BackgroundTheme>(() => {
    const storedTheme = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    return isBackgroundTheme(storedTheme) ? storedTheme : 'classic';
  });
  const [winningLineGeometry, setWinningLineGeometry] = useState<{ width: number; height: number; x1: number; y1: number; x2: number; y2: number } | null>(null);
  const operation = useRef(false);
  const gameRef = useRef<GameState | null>(null);
  const requestVersion = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const effectsGainRef = useRef<GainNode | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const handleColumnKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, column: number) => {
    let nextColumn: number | null = null;
    if (event.key === 'ArrowLeft') nextColumn = Math.max(0, column - 1);
    if (event.key === 'ArrowRight') nextColumn = Math.min(6, column + 1);
    if (nextColumn === null || nextColumn === column) return;
    event.preventDefault();
    setFocusedColumn(nextColumn);
    setHovered(nextColumn);
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-column="${nextColumn}"]`)?.focus();
  };

  useEffect(() => {
    document.documentElement.dataset.backgroundTheme = backgroundTheme;
    localStorage.setItem(BACKGROUND_STORAGE_KEY, backgroundTheme);
  }, [backgroundTheme]);

  useEffect(() => {
    localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(scoreboard));
  }, [scoreboard]);

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
      setOnlinePlayer(null);
      setOnlineToken('');
      setInviteCopied(false);
      window.history.replaceState(null, '', window.location.pathname);
      setLastDrop(null);
      setCelebration(null);
      setGame(fresh);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create a game.'); }
    finally { operation.current = false; setBusy(false); setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const sharedId = new URLSearchParams(window.location.search).get('game');
      const id = sharedId || localStorage.getItem(STORAGE_KEY);
      if (!id) { setLoading(false); await newGame(); return; }
      try {
        const existing = await getGame(id);
        if (active) {
          setGame(existing);
          localStorage.setItem(STORAGE_KEY, id);
          const credential = readOnlineTokens()[id];
          setOnlinePlayer(existing.online ? credential?.player ?? null : null);
          setOnlineToken(existing.online ? credential?.token ?? '' : '');
        }
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

  useEffect(() => {
    if (!game?.online || busy) return;
    let active = true;
    const interval = window.setInterval(() => {
      void getGame(game.id).then(latest => {
        if (!active) return;
        const current = gameRef.current;
        if (current?.id !== latest.id
          || !(latest.moves > current.moves || latest.playersJoined !== current.playersJoined || latest.status !== current.status)) return;
        if (current.status === 'in_progress' && latest.status === 'won'
          && onlinePlayer !== null && onlinePlayer !== latest.winner) setCelebration(latest.moves);
        gameRef.current = latest;
        setGame(latest);
      }).catch(error => {
        if (active) console.error('Could not refresh online game.', error);
      });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [game?.id, game?.online, busy, onlinePlayer]);

  const startOnlineMatch = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const created = await createOnlineGame();
      const tokens = readOnlineTokens();
      tokens[created.state.id] = { token: created.playerToken, player: created.player };
      localStorage.setItem(ONLINE_TOKENS_KEY, JSON.stringify(tokens));
      localStorage.setItem(STORAGE_KEY, created.state.id);
      window.history.replaceState(null, '', `?game=${encodeURIComponent(created.state.id)}`);
      setOnlinePlayer(created.player);
      setOnlineToken(created.playerToken);
      setGame(created.state);
      setLastDrop(null);
      setCelebration(null);
      setInviteCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start an online game.');
    } finally {
      operation.current = false;
      setBusy(false);
      setLoading(false);
    }
  };

  const joinOnlineMatch = async () => {
    if (!game?.online || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const joined = await joinGame(game.id);
      const tokens = readOnlineTokens();
      tokens[game.id] = { token: joined.playerToken, player: joined.player };
      localStorage.setItem(ONLINE_TOKENS_KEY, JSON.stringify(tokens));
      setOnlinePlayer(joined.player);
      setOnlineToken(joined.playerToken);
      setGame(await getGame(game.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join this game.');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };

  const copyInviteLink = async () => {
    if (!game?.online) return;
    const link = `${window.location.origin}${window.location.pathname}?game=${encodeURIComponent(game.id)}`;
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? `Could not copy invite link: ${e.message}` : 'Could not copy invite link.');
    }
  };

  const drop = async (column: number) => {
    if (!game || game.status !== 'in_progress' || busy || operation.current || game.board[0][column] !== 0
      || (game.online && (!onlineToken || onlinePlayer !== game.turn || game.playersJoined < 2))) return;
    const sound = effectsOn ? enableAudio() : null;
    const effectsOutput = sound ? getEffectsOutput(sound) : null;
    operation.current = true; setBusy(true); setError('');
    try {
      const updated = await makeMove(game.id, column, game.online ? onlineToken : undefined);
      const row = updated.board.findIndex((cells, index) => cells[column] !== game.board[index][column]);
      setLastDrop(row >= 0 ? { row, column, gameId: updated.id, move: updated.moves } : null);
      setGame(updated);
      if (updated.status === 'won') {
        setScoreboard(current => ({
          ...current,
          [updated.winner === 1 ? 'red' : 'yellow']: current[updated.winner === 1 ? 'red' : 'yellow'] + 1,
        }));
      }
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
  const canMove = !!game && !loading && !busy && game.status === 'in_progress'
    && (!game.online || (onlinePlayer === game.turn && game.playersJoined === 2));
  const statusText = loading ? 'Loading your match…'
    : busy ? 'Updating game…'
      : !game ? 'Ready to play?'
        : game.online && game.playersJoined < 2 ? 'Waiting for Player 2 to join'
          : game.online && !onlinePlayer ? 'Spectating · read-only'
            : game.online && game.status === 'won' && onlinePlayer !== null && onlinePlayer !== game.winner ? `You lost — ${playerName(game.winner)} wins!`
              : game.online && game.status === 'in_progress' && onlinePlayer !== game.turn ? `${playerName(game.turn)}’s turn — waiting for them`
                : game.online && game.status === 'in_progress' ? `Your turn — ${playerName(game.turn)}`
                  : description(game);
  const winningLine = game?.status === 'won' ? findWinningLine(game.board, game.winner) : [];
  const winningCells = new Set(winningLine.map(([row, col]) => `${row}-${col}`));
  gameRef.current = game;

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board || winningLine.length !== 4) {
      setWinningLineGeometry(null);
      return;
    }

    const updateLine = () => {
      const boardBounds = board.getBoundingClientRect();
      const centers = winningLine.map(([row, col]) => {
        const slot = board.querySelector<HTMLElement>(`.slot[data-row="${row}"][data-column="${col}"]`);
        if (!slot) return null;
        const bounds = slot.getBoundingClientRect();
        return {
          x: bounds.left + bounds.width / 2 - boardBounds.left,
          y: bounds.top + bounds.height / 2 - boardBounds.top,
        };
      });
      const first = centers[0];
      const last = centers[centers.length - 1];
      if (!first || !last) return;
      setWinningLineGeometry({
        width: boardBounds.width,
        height: boardBounds.height,
        x1: first.x,
        y1: first.y,
        x2: last.x,
        y2: last.y,
      });
    };

    updateLine();
    const observer = new ResizeObserver(updateLine);
    observer.observe(board);
    return () => observer.disconnect();
  }, [game?.id, game?.moves, game?.status, game?.winner]);

  return <main className="app-shell">
    {celebration !== null && game?.status === 'won' && <div key={`${game.id}-${celebration}`} className="victory-fireworks" aria-hidden="true">
      {Array.from({ length: 3 }, (_, burst) => <div className={`firework-burst firework-burst-${burst + 1}`} key={burst}>
        {Array.from({ length: 12 }, (_, particle) => <i key={particle} className="firework-particle" style={{ '--angle': `${particle * 30}deg`, '--distance': `${68 + (particle % 3) * 15}px` } as React.CSSProperties} />)}
      </div>)}
    </div>}
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><span>FOUR<span className="brand-light">INAROW</span></span></div>
    </header>
    <section className="layout">
      <div className="intro"><div className="eyebrow"><span className="eyebrow-dot"/> TWO PLAYERS · ONE WINNER</div><h1>Make your <em>move.</em></h1><p>Connect four discs in a row — vertically, horizontally, or diagonally — to claim victory.</p></div>
      <div className="game-panel">
        <div className="panel-heading"><div><span className="overline">CURRENT MATCH</span><h2>Connect Four</h2></div><span className="match-badge">{game?.online ? 'ONLINE MATCH' : 'LOCAL · 2 PLAYERS'}</span></div>
        <div className="players">
          <div className={`player-card red ${game?.status === 'in_progress' && (!game.online || game.playersJoined === 2) && game.turn === 1 ? 'active' : ''} ${game?.winner === 1 ? 'champion' : ''}`}><span className="player-disc"/><div><span className="player-caption">PLAYER ONE</span><strong>Red</strong><span className="player-score">{scoreboard.red} {scoreboard.red === 1 ? 'win' : 'wins'}</span></div>{game?.turn === 1 && game.status === 'in_progress' && (!game.online || game.playersJoined === 2) && <span className="playing">PLAYING</span>}{game?.winner === 1 && <span className="playing">WINNER</span>}</div>
          <span className="versus">VS</span>
          <div className={`player-card yellow ${game?.status === 'in_progress' && (!game.online || game.playersJoined === 2) && game.turn === 2 ? 'active' : ''} ${game?.winner === 2 ? 'champion' : ''}`}><span className="player-disc"/><div><span className="player-caption">PLAYER TWO</span><strong>Yellow</strong><span className="player-score">{scoreboard.yellow} {scoreboard.yellow === 1 ? 'win' : 'wins'}</span></div>{game?.turn === 2 && game.status === 'in_progress' && (!game.online || game.playersJoined === 2) && <span className="playing">PLAYING</span>}{game?.winner === 2 && <span className="playing">WINNER</span>}</div>
        </div>
        <div className={`status ${game?.status === 'won' ? 'status-win' : ''}`} role="status" aria-live="polite"><span className={`status-indicator ${game?.status === 'in_progress' ? game.turn === 1 ? 'red-dot' : 'yellow-dot' : ''}`}/><span>{statusText}</span><span className="move-counter">{game?.moves ?? 0} / 42 MOVES</span></div>
        {game?.online ? <section className="online-lobby" aria-label="Online match lobby">
          <div className="online-lobby-copy"><strong>Online match · {game.playersJoined}/2 players</strong><span>{onlinePlayer ? `You are Player ${onlinePlayer} (${playerName(onlinePlayer)}).` : 'You are watching as a spectator; spectators cannot make moves.'}</span></div>
          <div className="online-lobby-actions">
            {onlinePlayer === null && game.playersJoined < 2 && <button type="button" className="online-join" onClick={() => void joinOnlineMatch()} disabled={busy || loading}>Join as Player 2</button>}
            <button type="button" className="online-share" onClick={() => void copyInviteLink()}>{inviteCopied ? 'Link copied!' : 'Copy game link'}</button>
          </div>
        </section> : <div className="online-prompt"><span>Want to play with someone online?</span><button type="button" className="online-start" onClick={() => void startOnlineMatch()} disabled={busy || loading}>Start online game</button></div>}
        <div className="utility-menus">
        <details className="theme-menu">
          <summary className="theme-menu-trigger" aria-label={`Choose background style, currently ${backgroundThemes.find(theme => theme.id === backgroundTheme)?.label ?? 'Classic'}`} title="Background style"><span aria-hidden="true">✦</span><span>{backgroundThemes.find(theme => theme.id === backgroundTheme)?.label ?? 'Classic'}</span></summary>
          <div className="theme-popover" aria-label="Background styles">
            <span className="theme-menu-title">BACKGROUND STYLE</span>
            {backgroundThemes.map(theme => <button type="button" className={`theme-option theme-option-${theme.id}`} key={theme.id} aria-pressed={backgroundTheme === theme.id} onClick={() => setBackgroundTheme(theme.id)}>
              <span className="theme-swatch" aria-hidden="true"/><span><strong>{theme.label}</strong><small>{theme.description}</small></span>{backgroundTheme === theme.id && <span className="theme-check" aria-hidden="true">✓</span>}
            </button>)}
          </div>
        </details>
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
        </div>
        <div className="board-wrap"><div className="board" ref={boardRef} role="group" aria-label="Connect Four game board" aria-busy={loading || busy} aria-keyshortcuts="ArrowLeft ArrowRight Enter Space">
          {Array.from({length:7}, (_, col) => <button type="button" className="board-column" key={col} data-column={col} tabIndex={col === focusedColumn ? 0 : -1} onKeyDown={event => handleColumnKeyDown(event, col)} onMouseEnter={() => setHovered(col)} onMouseLeave={() => setHovered(null)} onFocus={() => { setFocusedColumn(col); setHovered(col); }} onBlur={() => setHovered(null)} onClick={() => void drop(col)} disabled={!game || isFinished} aria-disabled={!canMove || (!!game && game.board[0][col] !== 0)} aria-label={`${game?.online && !onlinePlayer ? 'Spectate' : `Drop ${game ? playerName(game.turn) : 'a'} disc in`} column ${col + 1}${game?.board[0][col] !== 0 ? ', column full' : ''}${!canMove && game?.online && onlinePlayer ? ', waiting for your turn' : ''}`}>
            {Array.from({length:6}, (_, row) => { const cell = game?.board[row][col] ?? 0; const winning = winningCells.has(`${row}-${col}`);
              const justDropped = !!cell && lastDrop !== null && game !== null && lastDrop.gameId === game.id && lastDrop.move === game.moves && lastDrop.row === row && lastDrop.column === col;
              return <span className={`slot ${winning ? 'slot-winning' : ''} ${hovered === col && row === 0 && !cell && !busy && !isFinished ? `slot-preview-${game?.turn}` : ''}`} key={`${row}-${col}-${justDropped ? game?.moves : 0}`} data-row={row} data-column={col} aria-label={`Row ${row + 1}, column ${col + 1}: ${cell ? playerName(cell) : 'empty'}${winning ? ', winning piece' : ''}`}>{cell !== 0 && <span className={`disc-piece ${cell === 1 ? 'slot-red' : 'slot-yellow'} ${justDropped ? 'disc-dropping' : ''}`} style={justDropped ? { '--drop-rows': row + 1, '--drop-duration': `${450 + (row + 1) * 85}ms` } as React.CSSProperties : undefined}><span className="disc-shine"/></span>}</span>; })}
          </button>)}
          {winningLineGeometry && <svg className="winning-connection" viewBox={`0 0 ${winningLineGeometry.width} ${winningLineGeometry.height}`} aria-hidden="true" focusable="false">
            <line x1={winningLineGeometry.x1} y1={winningLineGeometry.y1} x2={winningLineGeometry.x2} y2={winningLineGeometry.y2} className="winning-connection-shadow"/>
            <line x1={winningLineGeometry.x1} y1={winningLineGeometry.y1} x2={winningLineGeometry.x2} y2={winningLineGeometry.y2} className="winning-connection-stroke"/>
          </svg>}
        </div>
        {celebration !== null && game?.status === 'won' && <div key={`${game.id}-${celebration}-winner`} className={`winner-overlay winner-overlay-${game.winner} ${game.online && onlinePlayer !== null && onlinePlayer !== game.winner ? 'winner-overlay-loser' : ''}`} role="status" aria-live="polite">
          <span className="winner-overlay-disc" aria-hidden="true"/>
          <span><span className="winner-overlay-label">{game.online && onlinePlayer !== null && onlinePlayer !== game.winner ? 'DEFEAT' : 'VICTORY'}</span><strong>{game.online && onlinePlayer !== null && onlinePlayer !== game.winner ? 'You lost' : `${playerName(game.winner)} team wins!`}</strong></span>
          <span className="winner-overlay-mark" aria-hidden="true">{game.online && onlinePlayer !== null && onlinePlayer !== game.winner ? '×' : '★'}</span>
        </div>}</div>
        <div className="below-board"><span className="hint">↓ Select any column to drop your disc</span><button type="button" className="new-game" onClick={() => void newGame()} disabled={busy || loading}><span aria-hidden="true">↻</span> New game</button></div>
        <section className="keyboard-guide" aria-labelledby="keyboard-guide-title">
          <h3 id="keyboard-guide-title">Play with your keyboard</h3>
          <ol>
            <li><span>1</span><div>Press <kbd>Tab</kbd> until a game column has a white outline.</div></li>
            <li><span>2</span><div>Use <kbd>←</kbd> and <kbd>→</kbd> to choose a column.</div></li>
            <li><span>3</span><div>Press <kbd>Enter</kbd> or <kbd>Space</kbd> to drop your disc.</div></li>
          </ol>
        </section>
        <section className="move-history" aria-labelledby="move-history-title">
          <div className="move-history-heading"><h3 id="move-history-title">Move history</h3><span>{game?.history.length ?? 0} {(game?.history.length ?? 0) === 1 ? 'move' : 'moves'}</span></div>
          {game?.history.length ? <ol>{game.history.map((column, index) => {
            const player = index % 2 === 0 ? 1 : 2;
            return <li className={`history-move ${player === 1 ? 'history-red' : 'history-yellow'} ${index === game.history.length - 1 ? 'history-latest' : ''}`} key={`${index}-${column}`} aria-label={`Move ${index + 1}, ${playerName(player)}, column ${column + 1}`}>
              <span>{index + 1}</span><strong>{column + 1}</strong>
            </li>;
          })}</ol> : <p>No moves yet. The first move is Red.</p>}
        </section>
        {error && <div className="error" role="alert">{error} <button type="button" onClick={() => { setError(''); if (game) void getGame(game.id).then(setGame).catch(e => setError(String(e))); else void newGame(); }}>Retry</button></div>}
      </div>
      <div className="footnote"><span>HOW TO PLAY</span> Take turns dropping discs into the board. First to connect four wins. A full board without a winner is a draw.</div>
    </section>
    <footer>BUILT FOR THE LOVE OF THE GAME <span>·</span> CONNECT FOUR</footer>
  </main>;
}

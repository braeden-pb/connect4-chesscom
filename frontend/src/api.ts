export type Player = 0 | 1 | 2;
export type GameStatus = 'in_progress' | 'won' | 'draw';
export interface GameState {
  id: string;
  board: Player[][];
  turn: Player;
  status: GameStatus;
  winner: Player;
  moves: number;
  history: number[];
  online: boolean;
  playersJoined: number;
  row?: number;
}
export interface OnlineGame {
  state: GameState;
  playerToken: string;
  player: 1 | 2;
}
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}
async function requestData(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError('Unable to reach the game server. Check that the Go API is running.', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body;
}
async function request(path: string, init?: RequestInit): Promise<GameState> {
  const body = await requestData(path, init);
  if (!isGameState(body)) throw new ApiError('The server returned an unexpected game state.', 200);
  return body;
}
export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && /^[\da-f]{8}-[\da-f-]{27,}$/i.test(v.id)
    && Array.isArray(v.board) && v.board.length === 6
    && v.board.every(row => Array.isArray(row) && row.length === 7 && row.every(cell => cell === 0 || cell === 1 || cell === 2))
    && (v.turn === 0 || v.turn === 1 || v.turn === 2)
    && (v.winner === 0 || v.winner === 1 || v.winner === 2)
    && (v.status === 'in_progress' || v.status === 'won' || v.status === 'draw')
    && Number.isInteger(v.moves) && (v.moves as number) >= 0 && (v.moves as number) <= 42
    && Array.isArray(v.history) && v.history.length === v.moves
    && v.history.every(column => Number.isInteger(column) && column >= 0 && column < 7)
    && typeof v.online === 'boolean'
    && Number.isInteger(v.playersJoined) && (v.playersJoined as number) >= 0 && (v.playersJoined as number) <= 2;
}
export const createGame = () => request('/api/games', { method: 'POST' });
export async function createOnlineGame(): Promise<OnlineGame> {
  const body = await requestData('/api/games/online', { method: 'POST' });
  if (!isGameState(body) || !('playerToken' in body) || typeof body.playerToken !== 'string'
    || !('player' in body) || (body.player !== 1 && body.player !== 2)) {
    throw new ApiError('The server returned an unexpected online game.', 200);
  }
  return { state: body, playerToken: body.playerToken, player: body.player };
}
export async function joinGame(id: string): Promise<{ playerToken: string; player: 2 }> {
  const body = await requestData(`/api/games/${encodeURIComponent(id)}/join`, { method: 'POST' });
  if (!body || typeof body !== 'object' || !('playerToken' in body) || typeof body.playerToken !== 'string'
    || !('player' in body) || body.player !== 2) {
    throw new ApiError('The server returned an unexpected join response.', 200);
  }
  return { playerToken: body.playerToken, player: 2 };
}
export const getGame = (id: string) => request(`/api/games/${encodeURIComponent(id)}`);
export const makeMove = (id: string, column: number, playerToken?: string) => request(`/api/games/${encodeURIComponent(id)}/moves`, {
  method: 'POST',
  body: JSON.stringify({ column }),
  headers: playerToken ? { 'X-Player-Token': playerToken } : undefined,
});

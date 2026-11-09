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
  row?: number;
}
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}
async function request(path: string, init?: RequestInit): Promise<GameState> {
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
  if (!isGameState(body)) throw new ApiError('The server returned an unexpected game state.', response.status);
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
    && v.history.every(column => Number.isInteger(column) && column >= 0 && column < 7);
}
export const createGame = () => request('/api/games', { method: 'POST' });
export const getGame = (id: string) => request(`/api/games/${encodeURIComponent(id)}`);
export const makeMove = (id: string, column: number) => request(`/api/games/${encodeURIComponent(id)}/moves`, { method: 'POST', body: JSON.stringify({ column }) });

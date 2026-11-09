/** Return the four coordinates of a winning line, or an empty array. */
export function findWinningLine(board, winner) {
  if (winner !== 1 && winner !== 2) return [];
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      if (board[row]?.[col] !== winner) continue;
      for (const [dr, dc] of directions) {
        const line = Array.from({ length: 4 }, (_, step) => [row + step * dr, col + step * dc]);
        if (line.every(([r, c]) => r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === winner)) return line;
      }
    }
  }
  return [];
}

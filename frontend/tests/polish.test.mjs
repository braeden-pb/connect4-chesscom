import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findWinningLine } from '../src/winningLine.mjs';
const empty = () => Array.from({length: 6}, () => Array(7).fill(0));
for (const [name, positions] of [
  ['horizontal', [[5,1],[5,2],[5,3],[5,4]]],
  ['vertical', [[2,3],[3,3],[4,3],[5,3]]],
  ['diagonal down-right', [[1,0],[2,1],[3,2],[4,3]]],
  ['diagonal down-left', [[1,6],[2,5],[3,4],[4,3]]],
]) {
  test(`highlights exactly four ${name} winning pieces`, () => {
    const board = empty();
    positions.forEach(([r,c]) => {board[r][c] = 2;});
    assert.deepEqual(findWinningLine(board, 2), positions);
  });
}
test('no highlights on unfinished games or draws', () => {
  const board = empty(); board[5][0] = 1;
  assert.deepEqual(findWinningLine(board, 0), []);
  assert.deepEqual(findWinningLine(board, 1), []);
});
test('winning line uses winning player only', () => {
  const board = empty();
  for (let c=0;c<4;c++) board[5][c]=1;
  assert.deepEqual(findWinningLine(board, 2), []);
});
test('animation respects reduced motion and only triggers for new confirmed moves', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /const updated = await makeMove/);
  assert.match(app, /lastDrop\.move === game\.moves/);
  assert.match(app, /slot-winning/);
  assert.match(app, /slot-dropping/);
  assert.match(css, /@keyframes piece-drop/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('fireworks trigger only on newly confirmed wins, not restored games', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /if \(updated\.status === 'won'\) setCelebration\(updated\.moves\)/);
  assert.match(app, /setCelebration\(null\)/);
  assert.match(app, /aria-hidden="true"/);
  assert.match(app, /onAnimationEnd=/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /@keyframes firework-spark/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.victory-fireworks\{display:none/);
});

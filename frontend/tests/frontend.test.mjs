import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
test('uses the existing REST endpoints', () => {
  assert.match(api, /request\('\/api\/games', \{ method: 'POST' \}\)/);
  assert.match(api, /request\(`\/api\/games\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(api, /moves`, \{ method: 'POST', body: JSON\.stringify\(\{ column \}\)/);
});
test('renders 7 columns of 6 cells and sends moves', () => {
  assert.match(app, /Array\.from\(\{length:7\}/);
  assert.match(app, /Array\.from\(\{length:6\}/);
  assert.match(app, /await makeMove\(game\.id, column\)/);
});
test('handles wins, draws, turn display, and new games', () => {
  assert.match(app, /game\.status === 'won'/);
  assert.match(app, /game\.status === 'draw'/);
  assert.match(app, /game\.turn/);
  assert.match(app, /onClick=\{\(\) => void newGame\(\)\}/);
});
test('prevents invalid UI moves and duplicate submissions', () => {
  assert.match(app, /operation\.current/);
  assert.match(app, /game\.board\[0\]\[column\] !== 0/);
  assert.match(app, /game\.status !== 'in_progress'/);
});
test('proxies API requests to Go', () => assert.match(vite, /localhost:8080/));
test('supports API errors and state restoration', () => {
  assert.match(api, /response\.ok/);
  assert.match(app, /localStorage\.getItem/);
  assert.match(app, /getGame\(id\)/);
});

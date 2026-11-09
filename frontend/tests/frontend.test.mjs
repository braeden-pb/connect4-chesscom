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
  assert.match(app, /celebration !== null && game\?\.status === 'won' && <div key=\{`\$\{game\.id\}-\$\{celebration\}-winner`\} className=\{`winner-overlay winner-overlay-\$\{game\.winner\}`\}/);
  assert.match(app, /\{playerName\(game\.winner\)\} team wins!/);
  assert.match(app, /onClick=\{\(\) => void newGame\(\)\}/);
});
test('provides independent music, volume, and sound-effect controls', () => {
  assert.match(app, /aria-label="Audio settings"/);
  assert.match(app, /<details className="audio-menu">/);
  assert.match(app, /aria-label="Open audio settings"/);
  assert.match(app, /aria-pressed=\{musicOn\}/);
  assert.match(app, /aria-label="Music volume"/);
  assert.match(app, /aria-label="Music style"/);
  assert.match(app, /aria-pressed=\{effectsOn\}/);
  assert.match(app, /aria-label="Sound effects volume"/);
  assert.match(app, /const sound = effectsOn \? enableAudio\(\) : null/);
  assert.match(app, /arcade: \{/);
  assert.match(app, /retro: \{/);
  assert.match(app, /chill: \{/);
  assert.match(app, /label: 'Retro Lo-fi'/);
  assert.match(app, /interval: 320,\s*noteDuration: 0\.3,\s*noteWave: 'triangle'/);
  assert.match(app, /\}, \[musicOn, musicTrack\]\)/);
  assert.match(app, /noteWave: 'square' as OscillatorType/);
  assert.match(app, /noteWave: 'triangle' as OscillatorType/);
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

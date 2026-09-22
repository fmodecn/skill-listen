#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'skill-listen');
const BIN = path.join(ROOT, 'bin', 'skill-listen.js');

function fail(msg) { console.error('SMOKE FAIL: ' + msg); process.exit(1); }

const required = [
  'SKILL.md',
  'scripts/listen-runner.mjs'
];
for (const rel of required) {
  if (!fs.existsSync(path.join(SKILL_DIR, rel))) fail('missing ' + rel);
}

(async () => {
  // 1. skill runner module exports
  const mod = await import(pathToFileURL(path.join(SKILL_DIR, 'scripts', 'listen-runner.mjs')).href);
  for (const fn of ['resolveApiToken', 'probeDurationMs', 'transcribeFile']) {
    if (typeof mod[fn] !== 'function') fail('export ' + fn + ' is not a function');
  }

  // 2. bin help runs
  const help = spawnSync(process.execPath, [BIN, 'help'], { encoding: 'utf8' });
  if (help.status !== 0) fail('`skill-listen help` exited ' + help.status);
  if (!/skill-listen/.test(help.stdout || '')) fail('help output missing banner');

  // 3. bin path resolves
  const p = spawnSync(process.execPath, [BIN, 'path'], { encoding: 'utf8' });
  if (p.status !== 0) fail('`skill-listen path` exited ' + p.status);
  if (!/skill-listen/.test(p.stdout || '')) fail('path output missing skill name');

  console.log('SMOKE OK: skill-listen structure + runner exports verified');
  console.log('  install path: ' + (p.stdout || '').trim());
})().catch(e => fail(e.message));

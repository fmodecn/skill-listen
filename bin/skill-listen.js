#!/usr/bin/env node
// Copyright (c) 未来飞马
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Trademark Notice:
// The MPL-2.0 license grants copyright permissions for source code only.
// It does NOT grant any rights to use trademarks including "未来飞马",
// "Harness Loop", "RSI", and associated slogan "让AI进化提前发生，让AI落地快人一步".
// Any use of these trademarks requires separate written permission.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_NAME = 'skill-listen';
const SOURCE_ROOT = path.resolve(__dirname, '..');
const SKILL_SOURCE = path.join(SOURCE_ROOT, 'skills', SKILL_NAME);
const RUNNER = path.join(SKILL_SOURCE, 'scripts', 'listen-runner.mjs');
const WORKSPACE_ROOT = process.cwd();
const GLOBAL_TARGET = path.join(os.homedir(), '.claude', 'skills', SKILL_NAME);
const WORKSPACE_TARGET = path.join(WORKSPACE_ROOT, '.claude', 'skills', SKILL_NAME);
const WORKSPACE_SKILLS_ROOT = path.join(WORKSPACE_ROOT, '.claude', 'skills');
const GLOBAL_SKILLS_ROOT = path.join(os.homedir(), '.claude', 'skills');

const RUNNER_COMMANDS = new Set(['transcribe', 'run']);

function expandHome(value) {
  return String(value || '').replace(/^~(?=$|[\\/])/, os.homedir());
}

// ---------------------------------------------------------------------------
// Gateway runner passthrough
// ---------------------------------------------------------------------------
function runRunner(passthrough) {
  const result = spawnSync(process.execPath, [RUNNER, ...passthrough], { stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`skill-listen: failed to launch runner: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status == null ? 1 : result.status);
}

// Everything after the subcommand, dropping a single leading "--" separator.
function passthroughArgs(argv) {
  const rest = argv.slice(1);
  if (rest[0] === '--') return rest.slice(1);
  return rest;
}

// ---------------------------------------------------------------------------
// Skill installer (mirrors fmode-vision / fmode-ffmpeg)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const first = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'install';
  const args = { command: first, target: GLOBAL_TARGET, smoke: false, force: false, help: false };
  if (first === 'workspace' || first === 'install-workspace') {
    args.command = 'install';
    args.target = WORKSPACE_TARGET;
  }
  for (let i = first === argv[0] ? 1 : 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--target' && argv[i + 1]) args.target = argv[++i];
    else if (token.startsWith('--target=')) args.target = token.slice('--target='.length);
    else if (token === '--workspace') args.target = WORKSPACE_TARGET;
    else if (token === '--global') args.target = GLOBAL_TARGET;
    else if (token === '--smoke') args.smoke = true;
    else if (token === '--force') args.force = true;
    else if (token === '--help' || token === '-h') args.help = true;
  }
  args.target = path.resolve(expandHome(args.target));
  return args;
}

function printHelp() {
  console.log([
    'skill-listen — 录音转写网关客户端 + FmodeCode / Claude Code 技能安装器',
    '',
    '通过 Fmode 网关转写音频（讯飞录音文件转写，凭据仅服务端）：',
    '  npx skill-listen@latest transcribe -- audio.mp3 [--language autodialect] [--diarize]',
    '      需要 fmode token（环境变量 FMODE_API_TOKEN 或 ~/.fmode/config.json）',
    '',
    '安装 FmodeCode / Claude Code 技能：',
    '  npx skill-listen@latest workspace [--smoke]   # 安装到 ./.claude/skills/skill-listen',
    '  npx skill-listen@latest install [--smoke]     # 安装到 ~/.claude/skills/skill-listen',
    '  npx skill-listen@latest install --target <dir> [--force]',
    '  npx skill-listen@latest check',
    '  npx skill-listen@latest smoke',
    '  npx skill-listen@latest path',
    '',
    'Options:',
    '  --workspace      安装到 ./.claude/skills/skill-listen',
    '  --global         安装到 ~/.claude/skills/skill-listen（默认）',
    '  --target <dir>   安装到自定义目录',
    '  --force          允许覆盖自定义目录',
    '  --smoke          安装后运行冒烟检查',
    '  --help, -h       显示帮助'
  ].join('\n'));
}

function ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }

function isInside(parentDir, childDir) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(childDir));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function canOverwriteTarget(targetDir, force) {
  return force
    || path.resolve(targetDir) === path.resolve(GLOBAL_TARGET)
    || isInside(WORKSPACE_SKILLS_ROOT, targetDir)
    || isInside(GLOBAL_SKILLS_ROOT, targetDir);
}

function copyDirRecursive(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    ensureDir(destination);
    for (const child of fs.readdirSync(source)) {
      if (child === 'node_modules' || child === 'outputs' || child === '.git') continue;
      copyDirRecursive(path.join(source, child), path.join(destination, child));
    }
    return;
  }
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}

function installSkill(target, force) {
  if (!fs.existsSync(SKILL_SOURCE)) {
    throw new Error(`Skill source missing: ${SKILL_SOURCE}`);
  }
  if (fs.existsSync(target)) {
    if (!canOverwriteTarget(target, force)) {
      throw new Error(`Refusing to overwrite custom target without --force: ${target}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  ensureDir(target);
  copyDirRecursive(SKILL_SOURCE, target);
}

function checkSkill(target) {
  const required = ['SKILL.md', 'scripts/listen-runner.mjs'];
  const missing = required.filter(entry => !fs.existsSync(path.join(target, entry)));
  if (missing.length) {
    throw new Error(`Install target is missing required files: ${missing.join(', ')}`);
  }
  return { status: 'ok', skill: SKILL_NAME, target, required };
}

function runSmoke() {
  const result = spawnSync(process.execPath, ['scripts/smoke.js'], { cwd: SOURCE_ROOT, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error('smoke failed');
}

function printNextSteps(target) {
  const workspaceMode = isInside(WORKSPACE_SKILLS_ROOT, target);
  console.log('');
  console.log('Install complete.');
  console.log(`Skill installed at: ${target}`);
  console.log('');
  if (workspaceMode) {
    console.log('Project-level skill is ready. Restart the VSCode FmodeCode / Claude Code session if it was open.');
  } else {
    console.log('User-level skill is ready for all FmodeCode / Claude Code workspaces.');
  }
  console.log('');
  console.log('转写走 Fmode 网关（凭据仅服务端），客户端只需 fmode token。');
  console.log('Try this prompt in FmodeCode / Claude Code:');
  console.log('  把 meeting.mp3 转写成文字，开启说话人分离。');
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'install';

  // Gateway runner passthrough (handled before the installer arg parser).
  if (RUNNER_COMMANDS.has(command)) {
    runRunner(passthroughArgs(argv));
    return;
  }

  const args = parseArgs(argv);
  if (args.help || args.command === 'help') { printHelp(); return; }
  if (args.command === 'path') { console.log(args.target); return; }
  if (args.command === 'install') {
    installSkill(args.target, args.force);
    console.log(JSON.stringify(checkSkill(args.target), null, 2));
    if (args.smoke) runSmoke();
    printNextSteps(args.target);
    return;
  }
  if (args.command === 'check') { console.log(JSON.stringify(checkSkill(args.target), null, 2)); return; }
  if (args.command === 'smoke') { runSmoke(); return; }
  printHelp();
  process.exitCode = 1;
}

try { main(); }
catch (error) { console.error(`skill-listen failed: ${error.message}`); process.exit(1); }

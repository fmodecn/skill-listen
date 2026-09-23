// Copyright (c) 未来飞马
//
// Licensed under the MIT License. See LICENSE in the project root
// for the full license text.
//
// Trademark Notice:
// The MIT license grants copyright permissions for source code only.
// It does NOT grant any rights to use trademarks including "未来飞马",
// "Harness Loop", "RSI", and associated slogan "让AI进化提前发生，让AI落地快人一步".
// Any use of these trademarks requires separate written permission.
/**
 * skill-listen 录音转写网关客户端
 *
 * 通过 Fmode 网关 POST /api/listen/transcribe 调用讯飞「录音文件转写」。
 * 客户端不持有讯飞凭据——凭据仅在服务端。客户端只需携带 fmode token，
 * 服务端鉴权后调用讯飞并按音频时长计费（ceil(分钟) × 单价）。
 *
 * 导出：
 *   - resolveApiToken()    第0级 sessionToken 自举 + 回落链获取 fmode token
 *   - probeDurationMs()    用 ffprobe / fmode-ffmpeg 探测音频时长（可选）
 *   - transcribeFile()     上传本地音频文件并返回转写结果
 *
 * CLI:
 *   node listen-runner.mjs <audioFile> [--duration <ms>] [--language autodialect]
 *        [--diarize] [--speakers N] [--gateway <baseUrl>] [--out <file.json>]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

// ============================================================
// 配置
// ============================================================

// 网关基址：环境变量 > 默认线上地址
const DEFAULT_GATEWAY = process.env.FMODE_LISTEN_GATEWAY
  || 'https://server.fmode.cn/api/listen';

// ============================================================
// Token 解析（与 voc / fmode-vision 共享层一致）
// ============================================================
//
// 关键修复：fmode 的 newapi SK 默认就是 Claude Code 的 env.ANTHROPIC_AUTH_TOKEN，
// 存在 ~/.claude/settings.json（及 settings.local.json / 项目级 .claude/）。
// 旧实现只读进程环境变量 ANTHROPIC_AUTH_TOKEN，从不读这个文件——用户按 Claude Code
// 正常方式配好 SK，技能却「看不见」→ 判缺 token → 掉进旧付费弹窗死循环。
// 这里直接读该文件，且校验 sk- 开头、排除真 Anthropic sk-ant-、base 指向 fmode。
//
// 取值优先级（第0级为 sessionToken 自举，其余为回落链）：
//   0. sessionToken 自举：FMODE_SESSION_TOKEN 环境变量或 ~/.fmode/config.json 的
//      sessionToken → POST https://server.fmode.cn/api/fmode/voc-skill/install-prompt
//      → 从返回 prompt 中提取 fmode API token（sk- 开头，排除 sk-ant-）。
//      ⚠️ token 仅内存持有，不落盘不进日志。
//   1. 显式入参 token / 环境变量 FMODE_API_TOKEN
//   2. ~/.fmode/config.json → fmodeApiToken / newapiToken（FmodeStudio 保存写这里）
//   3. <cwd>/.fmode/config.json → fmodeApiToken / newapiToken
//   4. 进程注入的 ANTHROPIC_AUTH_TOKEN（Claude Code 把 settings.env 注入子进程时）
//   5. ~/.claude/settings.json 等文件里的 env.ANTHROPIC_AUTH_TOKEN（独立运行未被注入时）

const FMODE_API_BASE = (process.env.FMODE_API_BASE || 'https://server.fmode.cn').replace(/\/$/, '');

/** 第0级：解析 sessionToken（env FMODE_SESSION_TOKEN → ~/.fmode/config.json）。找不到返回 null。 */
function resolveSessionToken() {
  if (process.env.FMODE_SESSION_TOKEN) return process.env.FMODE_SESSION_TOKEN.trim();
  const p = path.join(os.homedir(), '.fmode', 'config.json');
  try {
    if (!fs.existsSync(p)) return null;
    const cfg = JSON.parse(fs.readFileSync(p, 'utf-8').replace(/^﻿/, ''));
    const t = cfg.sessionToken || (cfg.user && cfg.user.sessionToken) || null;
    return t && String(t).trim() ? String(t).trim() : null;
  } catch { return null; }
}

/**
 * 第0级：sessionToken → fmode API token（自举）。
 * 服务端唯一以 session 鉴权并返回 token 本体的端点是 voc-skill 安装指令生成器；
 * token 内嵌在返回 prompt 文本中，这里提取后仅内存持有（不落盘不进日志）。
 * @returns {Promise<string|null>} 提取失败返回 null（调用方回落下一级）。
 */
async function fetchApiTokenFromSession(sessionToken) {
  if (!sessionToken) return null;
  try {
    const res = await fetch(`${FMODE_API_BASE}/api/fmode/voc-skill/install-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-parse-session-token': sessionToken },
      body: JSON.stringify({ channel: 'claude-code', scope: 'user', source: 'skill-token-bootstrap' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const prompt = body && body.data && typeof body.data.prompt === 'string' ? body.data.prompt : '';
    const m = prompt.match(/sk-(?!ant-)[A-Za-z0-9_-]{8,}/);
    return m ? m[0] : null;
  } catch { /* 网络失败一律回落，不泄露错误细节 */ }
  return null;
}

function readJsonMaybe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

// 合并读取 Claude Code 的 settings env（用户级 + 项目级，含 .local 覆盖文件）。
function readClaudeSettingsEnv() {
  const files = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.local.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json'),
  ];
  const merged = {};
  for (const filePath of files) {
    const json = readJsonMaybe(filePath);
    const env = json && typeof json.env === 'object' && json.env ? json.env : null;
    if (!env) continue;
    for (const [key, value] of Object.entries(env)) {
      if (merged[key] === undefined && typeof value === 'string' && value.trim()) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

// 仅当 ANTHROPIC_AUTH_TOKEN 看起来是 fmode 的 newapi SK 时才采纳：
// - 必须 sk- 开头，且排除真 Anthropic 官方 key（sk-ant- 开头）；
// - 若设了 ANTHROPIC_BASE_URL，必须指向 fmode（否则这把 token 是发往别处的）。
function pickFmodeAnthropicToken(env) {
  const token = env && typeof env.ANTHROPIC_AUTH_TOKEN === 'string' ? env.ANTHROPIC_AUTH_TOKEN.trim() : '';
  if (!token || !/^sk-/i.test(token) || /^sk-ant-/i.test(token)) return '';
  const base = String((env && (env.ANTHROPIC_BASE_URL || env.ANTHROPIC_API_BASE)) || '').toLowerCase();
  if (base && !base.includes('fmode')) return '';
  return token;
}

/**
 * 获取 fmode API token。加载链优先级（第0级自举 → 回落）：
 *   0. sessionToken 自举（FMODE_SESSION_TOKEN 或 ~/.fmode/config.json）→ fmode API 换取
 *   1. 环境变量 FMODE_API_TOKEN
 *   2. ~/.fmode/config.json → fmodeApiToken / newapiToken（FmodeStudio 保存写这里）
 *   3. ~/.claude/settings.json 等 → env.ANTHROPIC_AUTH_TOKEN（sk- 开头非 sk-ant-）
 *   4. <project>/.fmode/config.json → fmodeApiToken / newapiToken
 *
 * @param {string} [projectRoot] 项目根目录，默认 process.cwd()
 * @returns {Promise<{ token: string, source: string }>}
 */
export async function resolveApiToken(projectRoot) {
  // 第0级自举：sessionToken → fmode API 换取
  const sessionToken = resolveSessionToken();
  if (sessionToken) {
    const bootstrapped = await fetchApiTokenFromSession(sessionToken);
    if (bootstrapped) {
      return { token: bootstrapped, source: 'level0:sessionToken->fmode-api' };
    }
    // 自举失败：明确报错指向重新登录，随后回落
    console.error('sessionToken 存在但换取 fmode API token 失败——sessionToken 缺失或失效，请重新登录 FMODE Studio 或配置 FMODE_SESSION_TOKEN');
  }

  if (process.env.FMODE_API_TOKEN) {
    return { token: process.env.FMODE_API_TOKEN, source: 'env:FMODE_API_TOKEN' };
  }

  const userConfigPath = path.join(os.homedir(), '.fmode', 'config.json');
  const userToken = readTokenFromConfig(userConfigPath);
  if (userToken) {
    return { token: userToken, source: userConfigPath };
  }

  const root = projectRoot || process.cwd();
  const projectConfigPath = path.join(root, '.fmode', 'config.json');
  const projectToken = readTokenFromConfig(projectConfigPath);
  if (projectToken) {
    return { token: projectToken, source: projectConfigPath };
  }

  // Claude Code 默认入口：进程注入的 ANTHROPIC_AUTH_TOKEN（sk-、base 指向 fmode）
  const injected = pickFmodeAnthropicToken(process.env);
  if (injected) {
    return { token: injected, source: 'env:ANTHROPIC_AUTH_TOKEN' };
  }

  // 兜底：直接读 ~/.claude/settings.json 等文件里的 env.ANTHROPIC_AUTH_TOKEN
  const claudeEnv = readClaudeSettingsEnv();
  const fromSettings = pickFmodeAnthropicToken(claudeEnv);
  if (fromSettings) {
    return { token: fromSettings, source: '~/.claude/settings.json:env.ANTHROPIC_AUTH_TOKEN' };
  }

  throw new Error(
    '未找到 Fmode API token。请通过以下任一方式提供（第0级自举 → 回落）：\n' +
    '  0. 登录 FMODE Studio 后自动自举（FMODE_SESSION_TOKEN 或 ~/.fmode/config.json 的 sessionToken）\n' +
    '  1. 环境变量 FMODE_API_TOKEN\n' +
    '  2. ~/.fmode/config.json 中 fmodeApiToken 字段（FmodeStudio 保存配置后写入）\n' +
    '  3. 项目 .fmode/config.json 中 fmodeApiToken 字段\n' +
    '  4. ~/.claude/settings.json 的 env.ANTHROPIC_AUTH_TOKEN（Claude Code 的 sk- token，会自动读取）\n' +
    '  注意：这是缺 token，不是「用不了」——请勿点任何付费/充值弹窗。'
  );
}

function readTokenFromConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
    return cfg.fmodeApiToken || cfg.newapiToken || null;
  } catch {
    return null;
  }
}

// ============================================================
// 音频时长探测（可选，用于计费预估）
// ============================================================

/**
 * 探测音频时长（毫秒）。优先用系统 ffprobe，其次 fmode-ffmpeg 的 ffprobe，
 * 失败则返回 0（服务端会以真实时长计费）。
 *
 * @param {string} audioPath
 * @returns {number} 毫秒，探测失败返回 0
 */
export function probeDurationMs(audioPath) {
  const candidates = [];
  if (process.env.FFPROBE_PATH) candidates.push(process.env.FFPROBE_PATH);
  candidates.push('ffprobe');

  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ];

  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, args, { encoding: 'utf-8' });
      if (r.status === 0 && r.stdout) {
        const sec = parseFloat(String(r.stdout).trim());
        if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
      }
    } catch { /* try next */ }
  }

  // 兜底：尝试 npx fmode-ffmpeg 的 ffprobe
  try {
    const r = spawnSync('npx', ['--yes', 'fmode-ffmpeg@latest', 'probe', '--', ...args], { encoding: 'utf-8' });
    if (r.status === 0 && r.stdout) {
      const sec = parseFloat(String(r.stdout).trim());
      if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
    }
  } catch { /* ignore */ }

  return 0;
}

// ============================================================
// 转写
// ============================================================

/**
 * 上传本地音频文件到网关并转写。
 *
 * @param {Object} opts
 * @param {string} opts.filePath      本地音频文件路径
 * @param {number} [opts.durationMs]  音频时长（毫秒）；缺省自动探测
 * @param {string} [opts.language]    识别语言，默认 autodialect
 * @param {boolean} [opts.diarize]    是否说话人分离
 * @param {number} [opts.speakers]    预期说话人数
 * @param {string} [opts.gateway]     网关基址，默认 DEFAULT_GATEWAY
 * @param {string} [opts.token]       手动传入 fmode token，否则自动解析
 * @returns {Promise<{ text: string, segments: any[], raw: object }>}
 */
export async function transcribeFile(opts) {
  const {
    filePath, language = 'autodialect', diarize = false,
    speakers, gateway = DEFAULT_GATEWAY,
  } = opts;

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`音频文件不存在: ${filePath}`);
  }

  const token = opts.token || (await resolveApiToken()).token;
  const audio = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  let durationMs = Number(opts.durationMs || 0);
  if (!durationMs) durationMs = probeDurationMs(filePath);

  const params = new URLSearchParams();
  params.set('fileName', fileName);
  if (durationMs) params.set('duration', String(durationMs));
  if (language) params.set('language', language);
  if (diarize) params.set('diarize', 'true');
  if (speakers) params.set('speakers', String(speakers));

  const url = `${gateway.replace(/\/$/, '')}/transcribe?${params.toString()}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: audio,
  });

  let body;
  const rawText = await res.text();
  try { body = JSON.parse(rawText); } catch { body = { raw: rawText }; }

  if (res.status === 402) {
    const url = body && body.rechargeUrl ? `\n充值链接：${body.rechargeUrl}` : '';
    throw new Error(`余额不足，请充值后重试。${url}`);
  }
  if (!res.ok || (body && body.code && body.code >= 400)) {
    const mess = (body && (body.mess || body.error)) || rawText || `HTTP ${res.status}`;
    throw new Error(`转写失败 (HTTP ${res.status}): ${mess}`);
  }

  const data = (body && body.data) || {};
  return {
    text: data.text || '',
    segments: data.segments || [],
    raw: body,
  };
}

// ============================================================
// CLI
// ============================================================

function parseCliArgs(argv) {
  const args = { language: 'autodialect', diarize: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--duration' && argv[i + 1]) args.durationMs = Number(argv[++i]);
    else if (t.startsWith('--duration=')) args.durationMs = Number(t.slice(11));
    else if (t === '--language' && argv[i + 1]) args.language = argv[++i];
    else if (t.startsWith('--language=')) args.language = t.slice(11);
    else if (t === '--diarize') args.diarize = true;
    else if (t === '--speakers' && argv[i + 1]) args.speakers = Number(argv[++i]);
    else if (t.startsWith('--speakers=')) args.speakers = Number(t.slice(11));
    else if (t === '--gateway' && argv[i + 1]) args.gateway = argv[++i];
    else if (t.startsWith('--gateway=')) args.gateway = t.slice(10);
    else if (t === '--out' && argv[i + 1]) args.out = argv[++i];
    else if (t.startsWith('--out=')) args.out = t.slice(6);
    else if (!t.startsWith('--')) positional.push(t);
  }
  args.filePath = positional[0];
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.filePath) {
    console.error('用法: node listen-runner.mjs <audioFile> [--duration <ms>] [--language autodialect] [--diarize] [--speakers N] [--gateway <baseUrl>] [--out <file.json>]');
    process.exit(1);
  }
  const result = await transcribeFile(args);
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(result.raw, null, 2));
    console.error(`已写入: ${args.out}`);
  }
  console.log(result.text);
}

// 仅在直接运行时执行 CLI
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
      || import.meta.url.endsWith(path.basename(process.argv[1] || ''));
  } catch { return false; }
})();

if (isMain) {
  main().catch((err) => {
    console.error(`skill-listen: ${err.message}`);
    process.exit(1);
  });
}

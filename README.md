# skill-listen · 录音转写技能（讯飞 LFASR × Fmode 网关）

> 把录音/视频的音轨转写成文字——**AI Agent 的"耳朵"**。
> 讯飞「录音文件转写」(LFASR) 异步识别，经 Fmode 网关 `POST /api/listen/transcribe` 完成。讯飞凭据仅服务端持有，客户端只需 fmode token，按音频真实时长计费。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-fmode--listen-blue)](https://www.npmjs.com/package/skill-listen)

## 能力

- 🎙️ 会议 / 采访 / 课程录音转文字（中英多语种 + 方言）
- 🎬 视频先抽音轨再转写（配合 `fmode-ffmpeg`：`npx fmode-ffmpeg exec -- -y -i in.mp4 -vn -ar 16000 -ac 1 out.wav`）
- 👥 说话人分离（多人对话按角色整理）
- 📄 输出纯文本或完整 JSON（`--out result.json`）

## 快速开始

```bash
# 直接连网关转写（无需安装技能，一行命令）
npx --yes skill-listen@latest transcribe -- meeting.mp3

# 指定语言 + 说话人分离 + 写出完整 JSON
npx --yes skill-listen@latest transcribe -- meeting.mp3 \
  --language autodialect --diarize --speakers 3 --out result.json

# 自定义网关（默认 https://server.fmode.cn/api/listen）
npx --yes skill-listen@latest transcribe -- meeting.mp3 --gateway https://server.fmode.cn/api/listen
```

> `transcribe` 后必须加 `--`，其后参数透传给运行器。

## 鉴权（token 从哪来）

客户端只需要 **fmode token**。运行器按以下优先级自动解析（**仓库与代码中无任何密钥**）：

0. **第0级自举（推荐）**：`FMODE_SESSION_TOKEN` 环境变量或 `~/.fmode/config.json` 的 `sessionToken` → 调 fmode API 动态换取 API token。登录 FMODE Studio 即可，**无需手工配置任何 token**；换取的 token 仅内存持有，不落盘不进日志。
1. 环境变量 `FMODE_API_TOKEN`
2. `~/.fmode/config.json` → `fmodeApiToken` / `newapiToken`（FmodeStudio 保存配置后写入）
3. 项目 `./.fmode/config.json` → 同上
4. 进程注入的 `ANTHROPIC_AUTH_TOKEN`（Claude Code 把 settings.env 注入子进程时自动命中）
5. `~/.claude/settings.json`（含 settings.local.json / 项目级 `.claude/`）的 `env.ANTHROPIC_AUTH_TOKEN` —— 即 Claude Code 的 `sk-` token（仅当 `sk-` 开头且非 `sk-ant-` 时采纳）

> 报「未找到 token」= 缺 token，不是技能坏——按上面任一来源补上即可。**不要把任何密钥写进本仓库或 issue。**

## 各工具安装指南

本技能遵循各 Agent 工具的 Skill 规范。**AI 拿到本仓库后，按自己工具对应的节安装。**

### Claude Code（推荐 npx 安装器）

```bash
npx --yes skill-listen@latest install          # 装到 ~/.claude/skills/skill-listen
npx --yes skill-listen@latest workspace        # 或装到当前项目 ./.claude/skills/
npx --yes skill-listen@latest check            # 校验安装
```

装完在 Claude Code 里直接说：「帮我把这段会议录音转成文字」即可触发。

### Codex

Codex 无 skill 机制，用 **CLI 直连**方式（技能体只是提示词封装）：

```bash
# AGENTS.md 里加一段：
# ## 录音转写
# 转写音频用: npx --yes skill-listen@latest transcribe -- <file> [--diarize --out out.json]
# token 从环境变量 FMODE_API_TOKEN 或 ~/.fmode/config.json 读取。
```

或直接把 `skills/skill-listen/SKILL.md` 内容粘进你的 `AGENTS.md` / 自定义 instructions。

### Gemini CLI

Gemini CLI 支持自定义命令（`~/.gemini/commands/`）。把 `skills/skill-listen/SKILL.md` 存为：

```
~/.gemini/commands/transcribe.toml
```

prompt 段写：`npx --yes skill-listen@latest transcribe -- {{args}}`，之后 `/transcribe meeting.mp3` 即可调用。

### WorkBuddy / 其他 Skill 规范工具

凡支持「SKILL.md + scripts/」目录规范的工具（WorkBuddy、Hermes 等）：

```bash
git clone https://github.com/fmodecn/skill-listen.git
cp -r skill-listen/skills/skill-listen <你的工具技能目录>/skill-listen
```

技能目录结构：

```
skill-listen/
├── SKILL.md            # 技能说明（frontmatter: name/description）
└── scripts/
    └── listen-runner.mjs   # 运行器（Node ≥18，零依赖）
```

### Hermes Agent

复制技能目录到 `~/.hermes/skills/`（或 profile 对应 skills 目录），Hermes 的 skill 加载器会读取 SKILL.md：

```bash
git clone https://github.com/fmodecn/skill-listen.git
cp -r skill-listen/skills/skill-listen ~/.hermes/skills/
hermes skills   # 确认 skill-listen 出现在列表
```

## 计费与安全

- **服务端计费**：`ceil(音频分钟数) × 单价`，不足 1 分钟按 1 分钟；余额不足返回 402 + 充值链接
- **凭据零下放**：讯飞 appId/apiKey/secretKey 只在服务端；本仓库任何代码/文档都不得写入真实密钥
- **网关可自托管**：`--gateway` 指向自建服务即可脱离 Fmode 云

## License

MIT

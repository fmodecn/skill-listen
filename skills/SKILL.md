---
name: fmode-listen
description: "把录音文件转写成文字（讯飞「录音文件转写」LFASR），通过 Fmode 网关 /api/listen/transcribe 完成。适用场景：(1) 会议/采访/课程录音转文字, (2) 视频先抽音轨再转写, (3) 需要中英多语种/方言识别, (4) 需要说话人分离的多人对话整理。讯飞凭据仅服务端持有，客户端只需 fmode token，服务端按音频真实时长计费。"
description_en: "Transcribe recorded audio to text (iFlytek LFASR) through the Fmode gateway /api/listen/transcribe. Use for: (1) meeting/interview/lecture transcription, (2) extracting audio from video then transcribing, (3) multi-language/dialect recognition, (4) speaker diarization for multi-speaker conversations. iFlytek credentials live only on the server; the client only needs an fmode token, and the server bills by actual audio duration."
---

# Fmode Listen — 录音转写网关技能

## Overview

本技能把本地音频文件交给 **Fmode 网关** `POST /api/listen/transcribe`，由服务端调用讯飞
「录音文件转写」（LFASR 异步转写）完成识别。

关键约束：
- **客户端不持有讯飞凭据**——appId/apiKey/secretKey 仅在服务端。客户端只需携带 **fmode token**。
- **计费在服务端**：服务端拿到真实音频时长后按 `ceil(分钟) × 单价` 扣费（与其它 Fmode APIG 模型同一套 newapi 计量统计），不足 1 分钟按 1 分钟计。余额不足返回 402 + 充值链接。
- 音频当前由网关中转上传讯飞（客户端 → 网关 → 讯飞），无需本地存储讯飞密钥。

> 与 `fmode-ffmpeg` 配合：视频或大体积音频先用 `npx fmode-ffmpeg exec -- -y -i input.mp4 -vn -ar 16000 -ac 1 out.wav` 转成 16kHz 单声道 wav，再交给本技能，能显著降低上传体积、提高识别稳定性。

## 鉴权（必读）

客户端只需提供 **fmode token**，运行器按以下优先级自动解析：

1. 环境变量 `FMODE_API_TOKEN`
2. `~/.fmode/config.json` 的 `fmodeApiToken` / `newapiToken` 字段（FmodeStudio 保存配置后写入）
3. 项目 `./.fmode/config.json` 的 `fmodeApiToken` / `newapiToken` 字段
4. `~/.claude/settings.json`（含 `settings.local.json` / 项目级 `.claude/`）的 `env.ANTHROPIC_AUTH_TOKEN`——**这就是 Claude Code 的 `sk-` token，运行器会自动读取，无需手动配置**。仅当 `sk-` 开头（排除真 Anthropic 的 `sk-ant-`）且 base 指向 fmode 时才采纳。

> 这把 `sk-` 就是你在 Claude Code / FmodeStudio 里配的 fmode newapi token，装完技能即可命中。若运行器报「未找到 token」，那是缺 token、**不是「用不了」**——请勿点任何付费/充值弹窗，按上面任一来源补上即可。
>
> 不要在任何示例或代码里写讯飞 appId/apiKey/secretKey——它们只属于服务端。

## 用法

### 命令行直接转写

```bash
# 基础：转写一个录音文件（自动探测时长用于计费预估）
npx --yes fmode-listen@latest transcribe -- meeting.mp3

# 指定语言 + 说话人分离 + 写出完整 JSON
npx --yes fmode-listen@latest transcribe -- meeting.mp3 \
  --language autodialect --diarize --speakers 3 --out result.json

# 自定义网关（默认 https://server.fmode.cn/api/listen）
npx --yes fmode-listen@latest transcribe -- meeting.mp3 --gateway https://server.fmode.cn/api/listen
```

`transcribe` 后必须加 `--`，其后参数透传给运行器。stdout 输出纯文本转写结果；`--out` 额外写出网关返回的完整 JSON。

### 在 Node 脚本中调用

技能目录被复制进 `.claude/skills/` 时**不含 node_modules**，运行器是零依赖的 ESM，可直接 import：

```js
import { transcribeFile, probeDurationMs, resolveApiToken }
  from './scripts/listen-runner.mjs';

const { text, segments, raw } = await transcribeFile({
  filePath: 'meeting.mp3',
  language: 'autodialect',   // 默认 autodialect（中英自动+方言）
  diarize: true,             // 说话人分离
  speakers: 3,               // 预期说话人数（可选）
  // durationMs: 123000,     // 可选；缺省自动 ffprobe 探测
  // gateway: 'https://server.fmode.cn/api/listen',
  // token: '...',           // 可选；缺省自动解析 fmode token
});
console.log(text);
```

## 参数说明

| 参数 | 含义 | 默认 |
|------|------|------|
| `<audioFile>` | 本地音频文件路径（位置参数） | 必填 |
| `--language` | 识别语言，如 `autodialect`（中英+方言自动）/ `cn` / `en` | `autodialect` |
| `--diarize` | 开启说话人分离 | 关 |
| `--speakers N` | 预期说话人数（配合 `--diarize`） | 自动 |
| `--duration <ms>` | 音频时长（毫秒），用于计费预估；缺省自动探测 | 自动 |
| `--gateway <url>` | 网关基址 | `https://server.fmode.cn/api/listen` |
| `--out <file>` | 写出网关返回的完整 JSON | 不写 |

## 网关接口

```
POST {gateway}/transcribe?fileName=meeting.mp3&duration=123000&language=autodialect&diarize=true&speakers=3
Headers: Authorization: Bearer <fmode token>
         Content-Type: application/octet-stream
Body:    原始音频字节
```

成功响应：
```json
{ "code": 200, "data": { "text": "...", "segments": [ ... ] } }
```

余额不足：
```json
{ "code": 402, "mess": "余额不足，请充值后重试", "rechargeUrl": "..." }
```

## 计费口径

- 按**音频真实时长**计费：`ceil(音频分钟) × 单价`，不足 1 分钟按 1 分钟计。
- 服务端在转写成功、拿到讯飞返回的真实时长后扣费；扣费走与其它 Fmode 模型同一套 newapi 计量，用量在统一后台可查。
- 客户端传的 `duration` 仅用于发起前的余额预校验，最终以服务端真实时长为准。

## 安装为 Claude Code 技能

```bash
# 项目级 → ./.claude/skills/fmode-listen
npx --yes fmode-listen@latest workspace

# 用户级 → ~/.claude/skills/fmode-listen
npx --yes fmode-listen@latest install
```

安装后可直接提示 Claude Code，例如：`把 meeting.mp3 转写成文字，开启说话人分离。`

## 注意事项

- 长音频转写是异步过程，网关会在服务端轮询讯飞直到完成再返回，请求耗时随时长增加，调用方注意超时设置。
- 大文件/视频先用 `fmode-ffmpeg` 压成 16kHz 单声道 wav 再转写，省带宽且更稳。
- 出现 401：检查 fmode token；出现 402：余额不足，按返回的 `rechargeUrl` 充值。
- 切勿在客户端写入讯飞密钥；凭据只在服务端。

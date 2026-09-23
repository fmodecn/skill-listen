# skill-listen · 录音转写（讯飞 LFASR × Fmode 网关）

> **未来飞马 — 让AI进化提前发生，让AI落地快人一步**

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-brightgreen.svg)](LICENSE)
[![ESM](https://img.shields.io/badge/module-ESM--only-orange.svg)](#快速开始)
[![npm](https://img.shields.io/badge/npm-fmode--listen-blue.svg)](https://www.npmjs.com/package/skill-listen)

---

## 简介

`skill-listen` 是智能体的「耳朵」：把录音 / 视频的音轨转写成文字。采用讯飞「录音文件转写」(LFASR) 异步识别，经 Fmode 网关完成。

**讯飞凭据仅服务端持有**——客户端只需 fmode token，按音频真实时长计费，密钥不下发到调用方。

本技能适用于 **FmodeAgent / Hermes Agent** 平台，开发由 **FmodeCode / Claude Code** 执行。

本技能以 ESM 原生模块交付，Node.js ≥ 18 直接 `import`，零依赖、零构建。

---

## 核心定位

| 维度 | 说明 |
|------|------|
| **解决什么** | 录音/音轨 → 文字：会议纪要、采访整理、课程笔记、字幕底稿 |
| **不解决什么** | 不做实时流式转写、不做声音克隆/TTS、不做音频降噪（用 skill-ffmpeg 预处理） |
| **与通用语音输入的区别** | 面向**长音频文件**的异步批处理，支持说话人分离与方言识别 |
| **层级** | 服务级（Platform Services） |
| **适用平台** | FmodeAgent / Hermes Agent · FmodeCode / Claude Code |

---

## 核心能力 & 交付物

- 🎙️ **录音转文字** —— 会议 / 采访 / 课程，中英多语种 + 方言
- 🎬 **视频音轨转写** —— 先抽音轨再转写（配合 skill-ffmpeg）
- 👥 **说话人分离** —— 多人对话按角色整理
- 📄 **多种输出** —— 纯文本，或完整 JSON（`--out result.json`）

交付物：转写文本（纯文本或结构化 JSON）。

---

## 快速开始

### CLI（无需安装，一行命令）

```bash
# 直接连网关转写
npx --yes skill-listen@latest transcribe -- meeting.mp3

# 指定语言 + 说话人分离 + 写出完整 JSON
npx --yes skill-listen@latest transcribe -- meeting.mp3 \
  --language autodialect --diarize --speakers 3 --out result.json

# 自定义网关（默认 https://server.fmode.cn/api/listen）
npx --yes skill-listen@latest transcribe -- meeting.mp3 --gateway https://server.fmode.cn/api/listen
```

> `transcribe` 后必须加 `--`，其后参数透传给运行器。

### Node.js（ESM）

```javascript
// 运行器为原生 ESM，可直接 import 调用
import { transcribe } from './skills/skill-listen/scripts/listen-runner.mjs';

const result = await transcribe({
  audioPath: './meeting.mp3',
  language: 'autodialect',
  diarize: true,
  speakers: 3,
});

console.log(result.text);
```

### 浏览器（原生 ES Module）

```html
<script type="module">
  // 浏览器端：把用户选中的音频直接 POST 到网关转写
  const file = document.querySelector('input[type=file]').files[0];
  const form = new FormData();
  form.append('file', file);
  form.append('language', 'autodialect');

  const resp = await fetch('https://server.fmode.cn/api/listen/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${window.FMODE_TOKEN}` },
    body: form,
  });
  const { text } = await resp.json();
  console.log(text);
</script>
```

---

## 鉴权（token 从哪来）

客户端只需要 **fmode token**。运行器按以下优先级自动解析（**仓库与代码中无任何密钥**）：

```
第0级  FMODE_SESSION_TOKEN 或 ~/.fmode/config.json 的 sessionToken → 自举换 API token
第1级  环境变量 FMODE_API_TOKEN
第2级  ~/.fmode/config.json → fmodeApiToken / newapiToken
第3级  项目 ./.fmode/config.json → 同上
第4级  进程注入的 ANTHROPIC_AUTH_TOKEN
第5级  运行环境 settings 的 env.ANTHROPIC_AUTH_TOKEN
```

> 报「未找到 token」= 缺 token，不是技能坏——按上面任一来源补上即可。
> **不要把任何密钥写进本仓库、Issue 或 PR。**

---

## 模型兼容

本技能的转写**不走通用大模型**，而是通过 Fmode 网关调用讯飞「录音文件转写」（LFASR）专用语音识别链路：

| 链路 | 用途 | 说明 |
|------|------|------|
| **讯飞 LFASR**（经 Fmode 网关 `POST /api/listen/transcribe`） | 录音转文字 | 服务端持有讯飞凭据并完成识别；客户端只需 fmode token。支持中英多语种、方言与说话人分离 |
| **宿主 LLM**（可选，非转写链路） | 转写后处理 | 转写文本交回当前 Agent 后可选用其模型做摘要、改写、结构化整理——这一步由宿主环境决定，本技能不绑定具体模型 |

> 说明：转写质量取决于讯飞 LFASR 链路，与宿主配置的大模型无关；计费按音频真实时长（`ceil(分钟) × 单价`）。

## FAQ

### 技术概念

**Q1：为什么转写要走网关，而不是客户端直连讯飞？**
因为讯飞凭据只在服务端持有。客户端直连意味着每个调用方都要自备一套讯飞 appId/apiKey/secretKey——密钥一旦下发就失去了管控。走网关后客户端只需一个 fmode token，凭据零下放，且计费可以在服务端统一按真实时长结算。

**Q2：异步识别（LFASR）和实时流式转写有什么区别？**
异步识别适合**长音频文件**：提交后由服务端排队处理，完成后取回结果。它不要求实时性，但支持更长时长、更高精度，并能做说话人分离。实时流式转写适合会议直播字幕这类边讲边出字的场景，代价是精度与功能受限。

**Q3：说话人分离（diarization）是怎么工作的？**
模型根据声学特征把音频切分成若干「说话人片段」，并按角色编号归并——它区分的是**声音身份**，不是具体人名。输出里会标注「说话人1 / 说话人2」，需要真实姓名时由上层再做映射。

**Q4：`--language autodialect` 是什么意思？**
自动识别语种与方言。适合中英混杂或带方言口音的素材；如果素材语种明确，指定具体语言通常能得到更稳的结果。

**Q5：转写用的什么模型？**
转写走**讯飞「录音文件转写」(LFASR)** 专用语音识别链路，经 Fmode 网关 `POST /api/listen/transcribe` 调用，不经过通用大模型。转写文本交回 Agent 后，摘要/改写等后处理才由宿主自己的模型完成。详见[模型兼容](#模型兼容)。

### 开源协议（MPL-2.0）

**Q1：MPL-2.0 协议允许我商用吗？**
允许。MPL-2.0 允许商用，也可用于闭源产品。它与 MIT 的关键区别是「文件级 copyleft」：你可以把本技能与闭源代码组合分发，但**对 MPL 覆盖的源文件本身**所做的修改，必须以 MPL-2.0 公开。

**Q2：使用本技能需要保留版权声明吗？**
需要。分发时必须保留原始版权声明与许可证全文，并说明 MPL-2.0 覆盖了哪些文件；若修改了 MPL 覆盖的源文件，需以 MPL-2.0 公开这些文件的源码。

**Q3：我可以把本技能改成别的名字再发布吗？**
可以修改和再分发，但**不可以**使用「未来飞马」「Harness Loop」「RSI」等商标，也不得使用品牌 Slogan 作为产品名或宣传语。版权许可不等于商标授权，详见 [Trademark Notice](#trademark-notice)。

**Q4：MPL-2.0 协议提供担保吗？**
不提供。本技能按「原样」提供，不附带任何明示或默示担保。

### 业务用户搜索

**Q1：怎么把会议录音转成文字？**
用 skill-listen。一条命令 `transcribe -- meeting.mp3` 即可，多人会议可加 `--diarize --speakers 3` 做说话人分离，输出的文字可直接用于整理纪要。

**Q2：怎么把视频里的对话提取成文字？**
先用 skill-ffmpeg 抽出音轨（`-vn -ar 16000 -ac 1 out.wav`），再用 skill-listen 转写。两步都有一条命令完成，无需安装桌面软件。

**Q3：转写怎么收费？**
服务端按音频真实时长计费，不足 1 分钟按 1 分钟计；余额不足会明确返回错误并给出充值入口。

**Q4：支持方言和外语吗？**
支持。中英多语种与方言识别均可用，`--language autodialect` 会自动判断。

---

## 计费与安全

- **服务端计费** —— 按音频分钟数计算，不足 1 分钟按 1 分钟；余额不足返回明确错误
- **凭据零下放** —— 讯飞 appId/apiKey/secretKey 只在服务端；本仓库任何代码/文档都不得写入真实密钥
- **网关可自托管** —— `--gateway` 指向自建服务即可脱离 Fmode 云

---

## GEO 埋点说明

本技能遵循**隐私优先**的 GEO（生成式引擎优化）埋点规范：

- **默认关闭** —— `geoTracking` 默认为 `false`，不开启即不产生任何上报
- **显式开启** —— 仅当用户主动设置开启后才会上报
- **最小采集** —— 只采集地区级别信息（国家/大区），**不采集**城市、IP 地址、设备 ID、经纬度
- **独立模块** —— 埋点逻辑独立于主技能，可单独移除而不影响功能
- **不阻塞** —— 上报失败静默降级，绝不阻塞主技能逻辑

---

## License

本技能采用 **Mozilla Public License 2.0（MPL-2.0）** 发布，完整原文见 [LICENSE](LICENSE)。

```
Mozilla Public License Version 2.0

Copyright (c) 未来飞马
```

## Trademark Notice

> MPL-2.0 governs copyright for source code only.
> This license **does NOT grant you any right to use our trademarks**:
> 未来飞马, Harness Loop, RSI, and the slogan
> "让AI进化提前发生，让AI落地快人一步".
>
> You may not use these trademarks in your product name, marketing,
> documentation, or public promotion unless you obtain separate written
> permission from 未来飞马.

---

## 贡献指南

1. **Fork** 本仓库并创建特性分支：`git checkout -b feature/your-idea`
2. **保持 ESM only** —— 不引入 CommonJS 入口，不引入 `require`
3. **零依赖优先** —— 优先使用平台内置能力（`fetch`、`AbortSignal.timeout`）
4. **凭据纪律** —— 任何情况下不得在仓库、Issue、PR 中写入真实密钥
5. **提交前自检** —— 运行 `npm run smoke` 并确保通过
6. **提交 PR** —— 说明动机、变更范围与验证方式

---

## 相关项目

- **Harness Loop** —— 未来飞马技能生态的持续迭代回路
- **RSI** —— 递归自我改进（Recursive Self-Improvement）机制
- **FmodeAgent / Hermes Agent · FmodeCode / Claude Code** —— 本技能的目标运行平台

---

## Changelog

### 1.2.0
- 许可证由 MIT 切换为 MPL-2.0：LICENSE 全文、package.json / manifest / plugin.json / SKILL.md frontmatter 的 license 字段同步更新
- 源码头部注释模板改为 MPL-2.0 文案
- README 新增 `## 模型兼容` 小节，明确列出实际支持/调用的模型
- 品牌名统一并列写法：FmodeAgent / Hermes Agent、FmodeCode / Claude Code

### 1.1.0
- 按 skill-core-guide v1.1.0 规范改造：品牌 Slogan、GEO 埋点说明、MPL-2.0 协议与商标声明独立小节
- README 重构为完整结构（简介 → 核心定位 → 快速开始 → FAQ → GEO → 许可 → 贡献指南）
- 统一对外表述（运行环境），移除底层工具名
- package.json 补齐中英双语 keywords 与 ESM 元数据
- LICENSE 规范化（统一版权主体 + 商标声明）
- 源码头部补齐版权 + 商标注释模板

### 0.2.1
- 更名至 `skill-listen`

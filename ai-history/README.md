# AI 简史 · 生产流水线

竖屏（9:16）科普短片《AI 简史》的可复用生产流水线。第 1 集是《图灵》。实施规格见《AI 简史 EP01 · 图灵 — 实施规格》，规格之外的设计选择记在 [DECISIONS.md](DECISIONS.md)。

## 快速开始

```bash
pnpm install
pnpm ep build ep001 --lang all --shots S01-S04   # M0：中英两版，S01–S04
pnpm test                                          # 图灵机、脚本解析、字幕断行、validate
pnpm typecheck
pnpm ep previews ep001                             # 重新生成组件预览图
pnpm studio                                        # Remotion Studio（可选）
```

需要 Node 22+、pnpm、ffmpeg/ffprobe。渲染所用的 Chromium 会自动查找 `/opt/pw-browsers`，也可以用 `REMOTION_BROWSER_EXECUTABLE` 指定。

## 命令

统一入口：`pnpm ep <stage> <episode> --lang zh|en|all [--shots S01-S04]`。`build` 按顺序跑完全部阶段，已缓存的部分直接跳过（日志里会标 `cache HIT` / `cache MISS`）。

| 阶段 | 做什么 | 产物（`episodes/<ep>/build/`） |
|---|---|---|
| `validate` | 校验全部 JSON 的 schema；检查 cue 序列、claim 引用和事实门禁；运行 lint | `validate.json`、`segments.<lang>.json` |
| `tts` | 逐段合成语音，缓存键 = hash(文本, 引擎, 音色, 参数) | `cache/tts/*.wav`、`<lang>/tts.json` |
| `timing` | 排时间轴（段间 150 ms、节拍间 400 ms、补足 minSec），做两遍 loudnorm | `timeline.<lang>.json`、`<lang>/narration.wav` |
| `captions` | 生成字幕（中文每行 ≤ 16 字、英文每行 ≤ 32 字符、每块 ≤ 2 行） | `captions.<lang>.json`、`<lang>/*.srt` |
| `render` | 按镜头渲染（以内容哈希缓存），再拼接并混入旁白 | `<lang>/shots/`、`<lang>/<ep>.<lang>.mp4`、`render.json` |
| `stills` | 在每个 cue 和镜头中点截取静帧，叠上安全区框，拼成 contact sheet，并生成审图包 | `<lang>/review/` |
| `qc` | 规格第 12 节的 10 项检查，任何一项失败就停止 | `qc.<lang>.json` |
| `export` | AI 标识、MP4、SRT、封面、平台元数据包 | `<lang>/export*/`、`manifest.<lang>.json` |

## 目录

```
series/            bible（design tokens）、claims（事实表）、entities、glossary、rules
episodes/ep001-turing/
  skeleton.json    节拍、镜头、cue 序列、视觉参数（与语言无关）
  script.<lang>.txt  旁白：{#cue} 文本 [[claim IDs]] 或 [[N]]
  strings.<lang>.json  屏幕文字
  documents.json   各语言版本都显示原文的历史文献引语
  meta.<lang>.json 平台元数据
  production.json  里程碑、人工分钟、claim 豁免、素材授权
packages/
  schemas/         全部 Zod schema（只在这里定义）
  components/      grammar/ 语法组件、signature/ 招牌镜头、shell/ 叠加层与布局探针
  pipeline/        各阶段 CLI
  tts/             TTS 适配器接口和 mock 引擎
remotion/          Root：Shot、Episode、LayoutProbe、Preview 四个组合
```

## 新增一种语言

只需要新增数据文件和配置：`script.<lang>.txt`、`strings.<lang>.json`、`meta.<lang>.json`，再在 `bible.json` 里加 `languages.<lang>`（字体和字幕规则）和 `voice.narrator.<lang>`（TTS）。组件代码不用改。

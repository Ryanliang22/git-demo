# series/rules

Ryan 每指出一个问题，就在这里新增一条规则（原则 8）。规则在整个系列中有效。

## 格式

每条规则一个文件：`R<三位编号>-<slug>.md`，例如 `R001-no-portrait.md`。

```markdown
---
id: R001
date: 2026-10-17
source: Ryan 审 EP01 M0 时指出
lint: <lint id，可省略>
---

## 规则
一句话描述。

## 正例
...

## 反例
...
```

## 自动检查

能自动检查的规则，在 `packages/pipeline/src/lints/` 里实现一个同名 lint，并在 frontmatter 的 `lint:` 写上它的 id。
`pnpm ep validate <ep>` 会运行全部 lint；frontmatter 里引用了不存在的 lint 会直接报错。

规格本身的原则（三层分离、时序挂在 cue 上、红色只用于 S05–S06 等）由内置 lint 检查，见 `pnpm ep lint`。

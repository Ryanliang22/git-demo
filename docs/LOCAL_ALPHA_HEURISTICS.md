# Local Alpha Heuristics

This file summarizes practical alpha design guidance extracted from local research notes:

- `C:/Users/Administrator/Desktop/alpha直属库/GODEN alpha灵感.txt`
- `C:/Users/Administrator/Desktop/alpha直属库/到底要交什么样的Alpha？——新人指南.txt`
- `C:/Users/Administrator/Desktop/alpha直属库/高质量alpha模板.txt`

## What Good Alpha Looks Like

- Do not judge an alpha by one metric alone.
- Sharpe, fitness, margin, turnover, robustness, and portfolio contribution all matter together.
- Quantity and quality should improve together over time; early breadth helps reveal the real hit rate.
- Economic meaning is a strong predictor of OS stability.

## Turnover Guidance

- Low turnover is not automatically good.
- High turnover can be acceptable when it drives return and margin.
- Bad turnover usually comes from noise, missing value handling, or unstable raw signals.
- The system should optimize turnover as part of a trade-off, not as a one-direction minimization target.

## Robustness Guidance

- Prefer signals that survive sub-universe tests.
- Penalize candidates that appear to rely only on illiquid tails.
- Use adversarial testing to detect concentrated, brittle, or unstable signals.

## Template Families Worth Encoding

- tail-risk exposure and standardized reverse beta variants
- analyst revision / earnings surprise structures
- news sentiment with industry or cap bucket normalization
- turnover anomaly, liquidity shock, and overnight reversal templates
- R&D intensity within industry/subindustry
- regression-neutralized multi-factor templates
- vector-neutralized and group-neutralized templates

## Optimization Guidance

- A paper idea often needs shaping before it reaches submission quality.
- Prefer structural mutations before numeric parameter sweeps.
- Keep formulas economically interpretable.
- Avoid needless complexity on sparse fundamental fields.
- Use local history to remember which template families tend to improve under which failure modes.

## Suggested Memory Features

Store for each optimization cycle:

- source idea family
- template family
- mutation type
- failure reasons
- sharpe, fitness, returns, turnover
- sub-universe behavior
- whether the mutation improved or degraded the candidate

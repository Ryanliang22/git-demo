# Multi-Agent Redesign Brief

## Current Baseline

This repository already contains a working paper-driven alpha research pipeline under `generation_one/naive-ollama/`.

Implemented pieces:

- `paper_research.py`: arXiv sync, PDF download, paper extraction, field mapping, template generation, expression instantiation, backtest persistence.
- `alpha_orchestrator.py`: new paper modes and orchestration wiring.
- `web_dashboard.py` + `templates/dashboard.html`: paper stats and manual trigger button.
- `paper_research.db`: runtime SQLite state for papers, templates, candidates, simulations, and mutation queue.

## Why A Redesign Is Needed

The current system can run end-to-end, but it is still mostly a single-pipeline workflow with limited transparency and weak iterative reasoning. The next stage should prioritize:

- explicit multi-agent responsibilities
- observable work traces in the UI
- strict budgeted stopping conditions
- lower wasted simulation spend
- better reuse of prior optimization history
- adversarial stress testing before a candidate is considered high quality
- a real self-improving research loop instead of one-pass generation

## Product Goals

Build a minimal, high-signal multi-agent research framework for WorldQuant alpha discovery.

Primary goals:

- keep the architecture simple and debuggable
- show what each agent is doing in near real time
- cap runtime, token cost, and simulation count
- stop automatically if quality does not improve
- make the system easy for another model to read and improve from GitHub
- absorb practical alpha heuristics from local research notes, not just papers

## Design Principle On The Old Pipeline

Do not preserve legacy code just because it already exists.

- if a module is still useful, extract and reuse it
- if a module is confusing, redundant, or blocks the multi-agent redesign, replace it
- compatibility is secondary to clarity for V2

This redesign should feel like a clean operational system, not a pile of backward-compatibility shims.

## Target Multi-Agent Design

Use a small set of specialized agents with a shared state store.

### Agent 1: Paper Scout

Responsibilities:

- search free arXiv papers in `q-fin.PR`, `q-fin.PM`, and `q-fin.RM`
- download PDFs locally
- extract hypothesis, economic mechanism, formulas, preprocessing, and dataset mentions
- produce concise `PaperCard` records
- rank papers by implementability instead of prestige or author affiliation

Expected output:

- top-N paper cards for the current round
- mapping hints for likely WorldQuant fields
- a short rationale for why a paper is worth instantiating

### Agent 2: Template Builder + Backtester

Responsibilities:

- convert selected paper ideas into alpha templates using the three-stage template method:
  - preprocessing
  - comparison relationship
  - final adjustment/risk-control
- instantiate expressions against currently available WorldQuant fields
- submit candidates for backtest
- log exact expressions and simulation metrics

Expected output:

- candidate expressions
- backtest results
- rejection reasons and pass/fail status

### Agent 3: Single-Template Optimizer

Responsibilities:

- focus on one promising template at a time
- use prior optimization history, failure reasons, and simulation metrics
- prefer structural changes before numeric tuning
- keep the search budget small and traceable

Expected output:

- mutation proposals
- before/after metrics
- explanation of why a mutation was attempted

### Agent 4: Adversarial Evaluator

Responsibilities:

- challenge the strongest current alpha candidate
- run 30 internal challenge attempts or until the budget is exhausted
- search for brittleness, concentration, weak sub-universe behavior, unstable turnover, or prompt-induced overfitting
- stop the round if no high-quality alpha survives the adversarial phase

Expected output:

- adversarial test log
- failure summary
- final "promote" or "stop" decision

## Auto Research Loop

The optimizer and evaluator should not operate as isolated one-shot calls. They should form a bounded auto research loop.

Loop skeleton:

1. select one candidate template
2. read paper evidence + prior optimization history + local alpha heuristics
3. propose a refined mutation
4. backtest
5. diagnose failure or improvement
6. update the optimization memory
7. either continue iterating or stop

Hard cap:

- maximum 30 improvement cycles for one template branch

Each cycle must produce:

- what was changed
- why it was changed
- what metrics improved or degraded
- what the next hypothesis is

This is a true self-iteration loop, not a repeated blind rerun.

## Branch-Managed Research

The auto research loop should use git branches as experiment boundaries, inspired by iterative research/code workflows.

Rules:

- one research round gets a parent branch
- one promising template branch gets its own child experiment branch
- each significant optimization step can be committed with a short, diagnostic commit message
- the winning branch can be merged or cherry-picked back
- failed branches remain readable history, not invisible transient state

The goal is not heavy git ceremony. The goal is:

- isolation
- reversibility
- readable experiment history
- easy handoff to another model or human reviewer

## Metric Diagnosis Before Optimization

When a candidate scores poorly, the system should diagnose why before mutating it.

Example diagnosis map:

- `LOW_SHARPE`
  - likely causes:
    - weak economic signal
    - noisy raw field
    - wrong sign
    - missing smoothing or standardization
    - poor residualization
  - likely fixes:
    - add `rank`, `zscore`, `ts_zscore`, or `decay`
    - reverse sign
    - add industry/subindustry neutralization
    - combine with a complementary confirming signal

- `LOW_FITNESS`
  - likely causes:
    - unstable return path
    - noisy tails
    - too much exposure to broad risk
  - likely fixes:
    - add `regression_neut`, `vector_neut`, or `group_neutralize`
    - reduce complexity
    - stabilize with rolling transforms

- `LOW_MARGIN`
  - likely causes:
    - turnover too high relative to edge
    - weak payoff per trade
  - likely fixes:
    - improve entry selectivity
    - add `trade_when`
    - smooth signal transitions
    - remove unstable trigger conditions

- `LOW_TURNOVER`
  - likely causes:
    - signal too slow
    - over-smoothed template
    - stale fundamental-only expression
  - likely fixes:
    - shorten windows
    - use deltas, rank changes, or event-like transforms
    - add a faster confirming data family

- `HIGH_TURNOVER`
  - likely causes:
    - missing smoothing
    - extreme-value sensitivity
    - raw noisy event triggers
  - likely fixes:
    - add decay or mean smoothing
    - winsorize or rank
    - gate trades with higher-confidence conditions

- `CONCENTRATED_WEIGHT`
  - likely causes:
    - raw magnitude imbalance
    - small-cap or thin-tail concentration
  - likely fixes:
    - group neutralize by cap bucket / industry
    - normalize or rank the core signal
    - reduce extreme tail exposure

- `LOW_SUB_UNIVERSE_SHARPE`
  - likely causes:
    - reliance on illiquid tails
    - poor portability across liquidity tiers
  - likely fixes:
    - add robustness constraints
    - use more liquid proxy fields
    - reduce dependence on narrow universes

- `HIGH_SELF_CORRELATION` or poor portfolio contribution
  - likely causes:
    - alpha is too close to existing style exposures
  - likely fixes:
    - switch idea family
    - add orthogonal confirmation data
    - residualize against style-like factors

Every optimization attempt should start with a machine-readable diagnosis record, not with a blind mutation.

## Shared Runtime Model

All agents should write to one shared store and one shared event feed.

Required shared objects:

- `PaperCard`
- `TemplateCard`
- `InstantiationCandidate`
- `SimulationRun`
- `OptimizationAttempt`
- `AdversarialTrial`
- `AgentEvent`
- `ResearchRound`

## UI Expectations

The dashboard should move from "button panel + aggregate counters" to "live research console".

Show:

- current round id
- active agent
- per-agent queue lengths
- recent events in chronological order
- exact current task per agent
- current paper, template, expression, or mutation under work
- simulation metrics for the most recent results
- stop reason when a round ends

Keep the UI minimal:

- one overview page
- one live event stream
- one candidate detail panel
- one controls row

## Efficiency Constraints

Design for low waste.

- avoid unnecessary concurrent LLM calls
- cap active concurrent simulations
- cache arXiv metadata and extracted paper cards
- deduplicate semantically similar templates
- never let all agents flood the backtest API at once
- stop a round early if the best score has not improved after a fixed budget

## Suggested Stop Rules

- stop a template after 30 adversarial trials with no surviving high-quality alpha
- stop an optimization branch after 5 consecutive non-improving mutations
- stop a round after the top score does not improve for 3 full cycles
- stop paper ingestion for the round once the candidate paper budget is filled

## Suggested Quality Gates

Use these as default gates, but keep them configurable:

- `sharpe >= 1.25`
- `fitness >= 1.0`
- acceptable turnover band defined per template
- no fatal DSL errors
- no concentrated weight failure
- no severe sub-universe collapse

## Practical Alpha Heuristics To Encode

The redesign should internalize the following research heuristics extracted from local notes:

- a single paper idea often has signal but still needs careful shaping before it is submission-grade
- optimize with economic meaning first, not by blindly chasing one metric
- treat quantity and quality as a spiral: build enough breadth, then raise the bar
- turnover is not simply "lower is always better"; prefer useful turnover that brings return and margin
- sub-universe robustness matters because signals that only work in thin tails are fragile
- description and rationale should be first-class artifacts because economic meaning improves OS behavior
- avoid overfitting from over-complex formulas, especially on sparse fundamental data
- structural alpha templates worth exploring include:
  - regression-neutralized templates
  - group-neutralized cross-sectional templates
  - turnover/volume shock templates
  - analyst/news/fundamental hybrid templates
  - reversal and tail-risk style templates
  - template families that explicitly mix signal strength and stability

## Template Search Bias

Bias the search space toward economically meaningful families seen in the local notes:

- tail risk and fragility
- analyst revision and earnings expectation dislocation
- news sentiment and price-volume interaction
- R&D intensity within industry or subindustry
- turnover abnormality, overnight shock, and liquidity-stress reversals
- robust residualization and regression-neutralized structures

## Engineering Priorities

1. preserve the working paper pipeline
2. factor it into a clean multi-agent scheduler
3. add observability before adding more search complexity
4. keep prompt outputs structured and machine-readable
5. write tests for queueing, state transitions, and stop conditions

## Non-Goals For The First Iteration

- no giant general-purpose agent swarm
- no fully autonomous infinite loop
- no hidden reasoning-only workflow with no visible traces
- no expensive prestige ranking system for papers
- no reliance on paid academic sources

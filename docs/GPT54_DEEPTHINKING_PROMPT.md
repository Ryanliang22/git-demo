# Prompt For GPT-5.4 Deep Thinking

You are reviewing and redesigning this repository as a high-transparency, minimal multi-agent alpha research system.

Repository:

- focus on `generation_one/naive-ollama/`
- the repo already contains a working paper-driven pipeline:
  - `paper_research.py`
  - `alpha_orchestrator.py`
  - `web_dashboard.py`
  - `templates/dashboard.html`

Your job is not to start from scratch. Your job is to deeply read the existing code, preserve what still works, discard what no longer earns its keep, and then propose and implement a clean, minimal, multi-agent redesign.

## Main Objective

Refactor the current paper-based alpha workflow into a compact multi-agent framework with four explicit agents:

1. `PaperScoutAgent`
2. `TemplateBacktestAgent`
3. `TemplateOptimizerAgent`
4. `AdversarialEvaluatorAgent`

The system should remain practical for WorldQuant-style alpha research and must expose what each agent is doing in the UI in near real time.

## Hard Requirements

### Product requirements

- Keep the design minimal.
- Keep the code readable and debuggable.
- Preserve the current working arXiv -> PDF -> extraction -> mapping -> template -> expression -> backtest chain.
- If parts of the old pipeline are low-value or obstructive, remove or replace them instead of preserving them for compatibility.
- Add visible multi-agent orchestration instead of a hidden monolithic loop.
- Show the concrete working process of each agent in the UI.
- It is acceptable, even desirable, to show detailed intermediate steps.
- Stop automatically if no high-quality alpha is produced.

### Agent responsibilities

#### 1. PaperScoutAgent

- Search free arXiv papers only.
- Scope papers to `q-fin.PR`, `q-fin.PM`, `q-fin.RM`.
- Prefer implementable empirical papers, not prestige or institution ranking.
- Download PDFs locally.
- Extract:
  - hypothesis
  - economic mechanism
  - formula candidates
  - data processing steps
  - dataset mentions
- Write structured `PaperCard` records.

#### 2. TemplateBacktestAgent

- Turn paper ideas into alpha templates.
- Follow the three-stage template method:
  - preprocessing
  - comparison relationship
  - detail adjustment / risk control
- Instantiate expressions using currently available WorldQuant fields.
- Submit candidates for backtest.
- Persist exact expressions and metrics.

#### 3. TemplateOptimizerAgent

- Work on one template at a time.
- Use prior optimization history and previous backtest results.
- Also use local alpha heuristics and high-quality template patterns summarized in the repo docs.
- Prefer structural optimization over pure numeric tuning.
- Explain each mutation attempt in structured form.

#### 4. AdversarialEvaluatorAgent

- Challenge the strongest current candidate.
- Run up to 30 adversarial trials.
- Look for brittleness, concentration, weak sub-universe behavior, unstable turnover, and obvious overfitting patterns.
- If no high-quality alpha survives, stop the round.

## Auto Research Loop Requirement

Implement a real bounded self-iteration loop for a single promising template branch.

Loop behavior:

1. read prior results
2. read the associated paper card and local heuristics
3. propose the next mutation
4. backtest it
5. diagnose failure or improvement
6. update memory
7. continue until success or stop

Rules:

- maximum 30 improvement cycles per branch
- each cycle must log the reason for the mutation
- each cycle must log what improved or got worse
- if no high-quality alpha is found after the 30-cycle loop, stop

## Branch-Managed Experimentation

Model the self-iteration loop with git branch management inspired by Andrej-style auto research workflows.

Requirements:

- treat one template optimization track as an isolated experiment branch
- make the branch history readable
- use commits to capture major mutation steps and the reason for each change
- allow easy comparison between branches
- do not add heavyweight process for its own sake; keep it practical

I want git to function as experiment memory and rollback infrastructure, not just code storage.

## Diagnosis-Driven Optimization

Do not optimize metrics blindly.

Before each mutation, diagnose why the score is weak.

I want an explicit failure-analysis layer such as:

- weak Sharpe -> noise, wrong sign, weak economics, missing smoothing, missing neutralization
- weak fitness -> unstable path, too much broad-risk exposure, poor robustness
- low margin -> too much turnover for the edge
- low turnover -> stale/slow signal
- high turnover -> noisy or unstable trigger logic
- concentrated weight -> missing normalization or group controls
- weak sub-universe performance -> reliance on illiquid tails or poor portability
- high self-correlation -> insufficient novelty for portfolio contribution

Then choose targeted fixes, not random ones.

## Stop Conditions

Implement strict stop logic:

- stop an optimization branch after repeated non-improving mutations
- stop the adversarial phase after 30 trials
- stop the round if no candidate reaches the quality threshold
- stop early when the best candidate does not improve for several cycles

## Quality Gates

Use configurable defaults similar to:

- `sharpe >= 1.25`
- `fitness >= 1.0`
- acceptable turnover band
- no fatal syntax or DSL incompatibility
- no concentrated weight failure
- no severe sub-universe collapse

## UI Requirements

Redesign the dashboard with extreme simplicity, but much better visibility.

I want to clearly see:

- which agent is currently active
- what each agent is doing right now
- current paper/template/expression under work
- recent agent events in order
- current queue lengths
- latest simulation metrics
- why a round stopped

Suggested UI sections:

- `System Overview`
- `Agent Activity Stream`
- `Current Candidates`
- `Round Controls`

Do not hide the workflow. Expose it.

## Architecture Requirements

- Use a shared state store.
- Prefer SQLite or another lightweight local solution already compatible with the repo.
- Add explicit event logging for agent actions.
- Keep concurrency bounded and efficient.
- Do not allow every agent to hammer APIs in parallel.
- Cache paper metadata, extraction results, and field mappings.

## Performance Requirements

- Optimize for practical local use on a Windows workstation.
- Avoid excessive threads or runaway subprocesses.
- Reuse current working backtest code instead of rewriting it unnecessarily.
- Avoid repeated LLM calls when cached structured results already exist.
- Keep token usage and simulation count under budget.

## Deliverables

Please produce all of the following:

1. a codebase audit of the current `generation_one/naive-ollama/` implementation
2. a proposed target architecture
3. a migration plan from the current pipeline to the multi-agent system
4. the actual code changes
5. UI changes that expose real agent activity
6. stop rules and concurrency controls
7. tests for queueing, state transitions, and stop conditions
8. updated documentation

## Important Constraints

- Follow the minimal design principle.
- Do not introduce a bloated generic agent framework.
- Reuse what is valuable from the currently working paper pipeline, but remove dead-weight legacy flow if it no longer helps.
- Keep local artifacts and secrets out of version control.
- Prefer structured JSON outputs for model-to-system communication.

## Reference Intent

Take inspiration from AutoResearch-style iterative research systems, but do not copy complexity for its own sake. The final design should feel intentionally small, observable, and production-practical.

## What To Read First

Start by reading:

- `generation_one/naive-ollama/paper_research.py`
- `generation_one/naive-ollama/alpha_orchestrator.py`
- `generation_one/naive-ollama/web_dashboard.py`
- `generation_one/naive-ollama/templates/dashboard.html`
- `docs/MULTI_AGENT_REDESIGN_BRIEF.md`
- `docs/LOCAL_ALPHA_HEURISTICS.md`

## Output Format

Respond in this order:

1. current-system audit
2. top risks and bottlenecks
3. target multi-agent architecture
4. phased implementation plan
5. concrete code changes
6. UI redesign plan
7. tests
8. final implementation notes

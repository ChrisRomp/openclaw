# Copilot Provider Overrides

This fork contains changes to make the GitHub Copilot provider's context windows, API types, and model definitions configurable — fixing premature compaction and incorrect API endpoint routing.

## Problem

The upstream `github-copilot` provider has three issues:

1. **Hardcoded 128k context window** — Claude Opus 4.6 supports 200k and Codex models support 400k, but compaction triggers at ~128k regardless of config overrides.
2. **Wrong API type for Claude models** — All models were routed to `/v1/responses` (`openai-responses`), but Claude models only work via `/chat/completions` (`openai-completions`) on the Copilot API.
3. **All-or-nothing provider config** — Adding explicit model entries in `openclaw.json` broke the implicit token exchange, causing HTTP 400 auth failures.

## Changes (3 files, ~50 LOC)

### 1. `src/agents/models-config.ts`

**Copilot provider merge** — Changed from skipping the implicit provider when an explicit config exists, to merging them (matching the existing Bedrock pattern). Users can now add model entries with `contextWindow`/`api` overrides in `openclaw.json` while keeping the implicit `baseUrl` and token exchange.

### 2. `src/agents/context-window-guard.ts`

**Config-driven context window** — Added `agents.defaults.models["provider/modelId"].params.contextWindow` as a resolution source for compaction. Priority order:

1. `models.providers[provider].models[id].contextWindow` (explicit provider config)
2. `agents.defaults.models["provider/modelId"].params.contextWindow` **(new)**
3. `model.contextWindow` (provider metadata / hardcoded default)
4. Default 200k fallback
5. Capped by `agents.defaults.contextTokens` (if lower)

### 3. `src/providers/github-copilot-models.ts`

**Per-model API types and context windows** — Updated `buildCopilotModelDefinition()` with correct defaults validated against the Copilot enterprise API:

| Model                  | API Type             | Context Window |
| ---------------------- | -------------------- | -------------- |
| `claude-opus-4.6`      | `openai-completions` | 200,000        |
| `claude-opus-4.5`      | `openai-completions` | 200,000        |
| `claude-sonnet-4.6`    | `openai-completions` | 200,000        |
| `claude-sonnet-4.5`    | `openai-completions` | 200,000        |
| `gpt-5.3-codex`        | `openai-responses`   | 400,000        |
| `gpt-5.2-codex`        | `openai-responses`   | 400,000        |
| Others (gpt-4.1, etc.) | `openai-completions` | 128,000        |

## Example `openclaw.json` config

After these changes, you can override context windows and add new models via config:

```json
{
  "models": {
    "providers": {
      "github-copilot": {
        "models": [
          {
            "id": "claude-opus-4.6",
            "name": "claude-opus-4.6",
            "api": "openai-completions",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

Or use the simpler per-model override path (no explicit provider entry needed):

```json
{
  "agents": {
    "defaults": {
      "models": {
        "github-copilot/claude-opus-4.6": {
          "params": { "contextWindow": 200000 }
        }
      }
    }
  }
}
```

## Syncing with upstream

This fork tracks `openclaw/openclaw` as the `upstream` remote.

```bash
# Fetch latest upstream changes
git fetch upstream

# Switch to copilot-overrides branch
git checkout copilot-overrides

# Rebase onto latest upstream main
git rebase upstream/main

# If conflicts occur (unlikely — changes touch stable, low-churn code):
# Resolve conflicts, then: git rebase --continue

# Push updated branch
git push origin copilot-overrides --force-with-lease
```

### Conflict risk

All 3 changes touch stable files with low commit frequency:

- `models-config.ts` — Copilot block unchanged since Jan 2026
- `context-window-guard.ts` — last substantive change Feb 2026
- `github-copilot-models.ts` — only 3 commits ever

Changes are additive (new code blocks between existing code), so git auto-merges cleanly in most cases.

## Deploying locally

```bash
# On the machine running openclaw:
git fetch origin
git checkout copilot-overrides

# Install dependencies (pnpm required — npm won't work with workspaces)
pnpm install

# Build
pnpm build

# Verify
pnpm test -- src/agents/context-window-guard.e2e.test.ts \
  src/agents/models-config.copilot-merge.e2e.test.ts \
  src/providers/github-copilot-models.test.ts
```

If pnpm is not installed: `npm i -g pnpm`

## Test coverage

New tests added:

- `src/agents/context-window-guard.e2e.test.ts` — 4 new tests for `agentModelParams` source and priority
- `src/agents/models-config.copilot-merge.e2e.test.ts` — 2 tests for merge behavior
- `src/providers/github-copilot-models.test.ts` — 8 tests for per-model API types, context windows, and case-insensitive lookup

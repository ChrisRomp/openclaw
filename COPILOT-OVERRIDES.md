# Copilot Provider Overrides

This fork contains changes to make the GitHub Copilot provider's context windows and model definitions configurable — fixing premature compaction and enabling models not yet in the upstream registry.

## Problem

The upstream `github-copilot` provider has two issues:

1. **Hardcoded context windows** — The upstream pi-ai model registry hardcodes 128k context for most Copilot models, but the Copilot API reports different (often larger) values. Compaction triggers prematurely.
2. **All-or-nothing provider config** — Adding explicit model entries in `openclaw.json` broke the implicit token exchange, causing HTTP 400 auth failures.

## API types (important)

The Copilot API proxies multiple backend APIs. Use the correct `api` type per model family:

| Model Family    | API Type             | Reasoning | Notes                                       |
| --------------- | -------------------- | --------- | ------------------------------------------- |
| Claude (all)    | `anthropic-messages` | `true`    | Native Anthropic Messages API with thinking |
| Gemini          | `openai-completions` | varies    | OpenAI-compatible `/chat/completions`       |
| GPT-4.x, GPT-4o | `openai-completions` | `false`   | OpenAI-compatible `/chat/completions`       |
| GPT-5.x, Codex  | `openai-responses`   | `true`    | OpenAI Responses API `/v1/responses`        |
| Grok            | `openai-completions` | `true`    | OpenAI-compatible `/chat/completions`       |

**Claude models must use `anthropic-messages`** — not `openai-completions`. The Copilot proxy supports the native Anthropic API including extended thinking with signatures. Using `openai-completions` breaks thinking block signatures in conversation history, causing HTTP 400 errors on subsequent turns.

## Copilot API context windows

Values from the Copilot enterprise `/models` endpoint (fetched 2026-02-19):

| Model               | API `max_prompt` | API `max_output` | pi-ai default     |
| ------------------- | ---------------- | ---------------- | ----------------- |
| `claude-opus-4.6`   | 128,000          | 64,000           | 128,000           |
| `claude-sonnet-4.6` | 128,000          | 32,000           | 128,000           |
| `claude-opus-4.5`   | 128,000          | 32,000           | 128,000           |
| `claude-sonnet-4.5` | 128,000          | 32,000           | 128,000           |
| `gpt-5.3-codex`     | 272,000          | 128,000          | _not in registry_ |
| `gpt-5.2-codex`     | 272,000          | 128,000          | 272,000           |
| `gpt-5.1-codex-max` | 128,000          | 128,000          | 128,000           |
| `gpt-5.1`           | 128,000          | 64,000           | 128,000           |
| `gpt-5-mini`        | 128,000          | 64,000           | 128,000           |

### Fetching model data from the Copilot API

The Copilot API requires a Copilot API token (obtained via OAuth token exchange, not a PAT) and IDE headers:

```bash
# Get cached Copilot token (from OpenClaw's credential store)
COPILOT_TOKEN=$(jq -r '.token' ~/.openclaw/credentials/github-copilot.token.json)

# Fetch models
curl -s "https://api.enterprise.githubcopilot.com/models" \
  -H "Authorization: Bearer $COPILOT_TOKEN" \
  -H "Editor-Version: vscode/1.107.0" \
  -H "Editor-Plugin-Version: copilot-chat/0.35.0" \
  -H "Copilot-Integration-Id: vscode-chat" | \
  jq '[.data[] | {id, max_prompt: .capabilities.limits.max_prompt_tokens, max_output: .capabilities.limits.max_output_tokens}]'
```

**Note:** PATs (`github_pat_*`) cannot access the Copilot token exchange endpoint. You need an OAuth token obtained through OpenClaw's device flow (`openclaw configure` / `openclaw login`).

## Required headers

The Copilot API requires IDE-style headers for authentication. Models defined in `openclaw.json` must include them (pi-ai built-in models have these baked in):

```json
"headers": {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat"
}
```

Without these headers, the API returns: `HTTP 400: bad request: missing Editor-Version header for IDE auth`

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

**Per-model defaults** — Updated `buildCopilotModelDefinition()` with `MODEL_OVERRIDES` for models not yet in pi-ai's registry (e.g., `gpt-5.3-codex`). These serve as fallback defaults; explicit `openclaw.json` config takes priority.

## Example `openclaw.json` config

### Adding a model not in the upstream registry

Models not in pi-ai's built-in registry (e.g., `gpt-5.3-codex`) need explicit provider model entries with all required fields including headers:

```json
{
  "models": {
    "providers": {
      "github-copilot": {
        "baseUrl": "https://api.enterprise.githubcopilot.com",
        "models": [
          {
            "id": "gpt-5.3-codex",
            "name": "gpt-5.3-codex",
            "api": "openai-responses",
            "reasoning": true,
            "input": ["text", "image"],
            "headers": {
              "User-Agent": "GitHubCopilotChat/0.35.0",
              "Editor-Version": "vscode/1.107.0",
              "Editor-Plugin-Version": "copilot-chat/0.35.0",
              "Copilot-Integration-Id": "vscode-chat"
            },
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 272000,
            "maxTokens": 128000
          }
        ]
      }
    }
  }
}
```

### Overriding context windows for existing models

For models already in pi-ai's registry, use the simpler per-model override (no explicit provider entry needed):

```json
{
  "agents": {
    "defaults": {
      "models": {
        "github-copilot/claude-opus-4.6": {
          "params": { "contextWindow": 128000, "maxOutputTokens": 64000 }
        },
        "github-copilot/gpt-5.2-codex": {
          "params": { "contextWindow": 272000, "maxOutputTokens": 128000 }
        }
      }
    }
  }
}
```

### Setting the primary model

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "github-copilot/claude-opus-4.6"
      }
    }
  }
}
```

## Running alongside an existing installation

If another user/instance is already running OpenClaw on the same machine:

1. The `~/.openclaw/` state dir is per-user (separate home directories), so no config conflicts.
2. Set `gateway.port` in `openclaw.json` to avoid port conflicts (default is `18789`).
3. Bonjour name conflicts are resolved automatically (cosmetic `(2)` suffix in logs).

```json
{
  "gateway": {
    "port": 18790
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

## Troubleshooting

| Error                                                      | Cause                                                                                                       | Fix                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Unknown model: github-copilot/...`                        | Model not in pi-ai registry and no explicit config entry                                                    | Add full model definition under `models.providers.github-copilot.models`             |
| `missing Editor-Version header for IDE auth`               | Explicit model config missing required headers                                                              | Add `headers` block (see above)                                                      |
| `invalid signature in thinking block`                      | Conversation history contains thinking blocks from a model using wrong API type, or from a previous session | Start a new conversation (`/new`); ensure Claude models use `anthropic-messages` API |
| `models.providers.github-copilot.baseUrl: expected string` | Provider config missing `baseUrl`                                                                           | Add `"baseUrl": "https://api.enterprise.githubcopilot.com"`                          |
| `Resource not accessible by personal access token`         | Using a PAT to access Copilot token exchange                                                                | Use OAuth token from `openclaw configure` / `openclaw login`                         |

## Test coverage

New tests added:

- `src/agents/context-window-guard.e2e.test.ts` — 4 new tests for `agentModelParams` source and priority
- `src/agents/models-config.copilot-merge.e2e.test.ts` — 2 tests for merge behavior
- `src/providers/github-copilot-models.test.ts` — 8 tests for per-model API types, context windows, and case-insensitive lookup

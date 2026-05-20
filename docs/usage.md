# Usage Guide — Archeology Power

## Available Tools

Archeology exposes 9 MCP tools that the Kiro agent can invoke automatically based on conversation context.

---

## 1. `analyze_intent` — Historical Intent Analysis

Reveals why a block of code exists by analyzing Git history.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file (relative to repo root) |
| `startLine` | number | Yes | Starting line (1-indexed) |
| `endLine` | number | Yes | Ending line (max 500 lines from startLine) |

### Example usage

```
"Why does this function exist in src/auth/validator.ts lines 45-80?"
```

### Response

Returns up to 10 commits ordered from most recent to oldest, each with:
- Author and date
- Natural language summary (≤500 characters)
- PR/issue reference if available
- Discussion summary (≤300 characters) if PR comments exist

---

## 2. `detect_shadow_debt` — Hidden Technical Debt Detection

Identifies files with high contributor churn and stale documentation.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | No | Directory to analyze (default: repo root) |
| `contributorThreshold` | number | No | Minimum contributors to flag (default: 20, min: 1) |
| `docStalenessMonths` | number | No | Months without doc updates to consider stale (default: 6, min: 1) |
| `analysisPeriodMonths` | number | No | Analysis period in months (default: 12, min: 3) |

### Example usage

```
"Which files have the most technical debt in src/?"
```

### Response

List of Archaeological Risk Zones with:
- File path
- Number of unique contributors
- Last documentation update date
- Calculated Churn Score

---

## 3. `ask_oracle` — Oracle Chat

Answers natural language questions about the repository's evolution.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | Yes | Question (max 500 characters) |

### Example questions

- "When was the Redis dependency introduced?"
- "Who last refactored the payments module?"
- "Why do we use the Observer pattern in the event bus?"
- "What tickets are associated with src/auth/validator.ts?"

### Response

Factual answer with:
- Response text
- Verifiable references (commit SHA, PR number, file path)
- Confidence level (high/medium/low)

> **Note**: Requires the Knowledge Graph to be in `ready` state.

---

## 4. `get_excavation_card` — Excavation Card

Generates a card with historical context for old files.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file |

### Trigger criteria

- The file's first commit must be older than 2 years
- The file must have at least 2 commits

### Response

- Original author (first commit)
- Current maintainer (most commits in last 12 months)
- Last major refactoring (commit modifying >30% of lines)
- Cyclomatic complexity
- Unavailable fields explicitly marked

---

## 5. `check_refactor_safety` — Pre-Refactor Safety Check

Analyzes whether deleting a block of code is safe by reviewing its history.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file |
| `startLine` | number | Yes | Starting line of the block to delete |
| `endLine` | number | Yes | Ending line of the block to delete |

### Example usage

```
"Is it safe to remove lines 52-80 from src/payments/processor.ts?"
```

### Response

- `safe: true/false` — Whether it's safe to delete
- List of warnings with:
  - Associated case/bug ID
  - Description of the problem the code was solving
  - Commit SHA and PR number
  - Severity (high/medium)

> Only analyzes blocks of more than 10 consecutive lines.

---

## 6. `run_migration_scout` — Migration Scout

Generates a readiness report for migrating a module.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Directory of the module to analyze |

### Example usage

```
"I want to extract the src/payments module into a microservice. What are the risks?"
```

### Response

Classification of each file:
- **Safe** — No hidden dependencies, safe to move
- **Investigate** — Has logical couplings or security patches
- **Do-not-migrate** — Dead code (no usage or modifications in 24 months)

Includes executive summary with distribution and top 5 highest-risk files.

---

## 7. `get_logical_coupling` — Logical Coupling Map

Identifies files that are frequently modified together.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File to analyze |
| `coOccurrenceThreshold` | number | No | Minimum co-occurrence ratio (default: 0.70, min: 0.50) |
| `analysisPeriodMonths` | number | No | Analysis period in months (default: 12, min: 3) |

### Example usage

```
"What other files always change together with src/core/router.ts?"
```

### Response

List of coupled files (max 20) with:
- Co-occurrence percentage
- Number of shared commits
- The 3 most recent commits where both were modified

---

## 8. `get_graph_status` — Knowledge Graph Status

Returns the current state of the knowledge graph.

### Parameters

None.

### Response

```json
{
  "state": "ready",
  "lastUpdated": "2025-05-19T10:30:00Z",
  "totalNodes": {
    "files": 234,
    "commits": 1847,
    "authors": 12,
    "tickets": 89
  }
}
```

---

## 9. `configure` — Configuration

Updates the power's configuration parameters.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `settings` | object | Yes | Object with fields to update |

### Configurable fields

| Field | Default | Minimum | Description |
|-------|---------|---------|-------------|
| `contributorThreshold` | 20 | 1 | Contributor threshold for Shadow Debt |
| `docStalenessMonths` | 6 | 1 | Months to consider docs stale |
| `analysisPeriodMonths` | 12 | 3 | Churn analysis period |
| `coOccurrenceThreshold` | 0.70 | 0.50 | Co-occurrence threshold for coupling |
| `couplingAnalysisPeriodMonths` | 12 | 3 | Coupling analysis period |
| `fileAgeThresholdYears` | 2 | — | Minimum age for Excavation Card |
| `deletionLineThreshold` | 10 | — | Minimum lines to trigger safety check |

### Example

```
"Set the contributor threshold to 10 and the analysis period to 24 months"
```

---

## Recommended Workflows

### Exploring legacy code

1. `get_excavation_card` → File overview
2. `analyze_intent` → Understand specific lines
3. `check_refactor_safety` → Before modifying

### Evaluating technical debt

1. `detect_shadow_debt` → Identify risk zones
2. `ask_oracle` → Investigate why they're problematic
3. `get_logical_coupling` → Understand hidden dependencies

### Planning a migration

1. `run_migration_scout` → Full module classification
2. `get_logical_coupling` → Detail on "investigate" files
3. `check_refactor_safety` → Before removing dead code

---

## Limitations

- Analysis depends on Git history quality (descriptive commit messages improve results)
- Repositories with less than 3 months of history have limited functionality
- The initial Knowledge Graph may take several minutes for large repositories (>10,000 commits)
- Dead code detection combines static analysis (invocations) with Git history (modifications) — may have false positives for dynamically invoked code

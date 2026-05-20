# Shadow Debt Workflow

Guide for detecting hidden technical debt and querying repository history using the Archeology Power.

## Tools Covered

- `detect_shadow_debt` — Identifies files with high churn and poor documentation (Archaeological Risk Zones)
- `ask_oracle` — Answers natural language questions about the repository's historical evolution

## When to Use `detect_shadow_debt`

Use this tool when:

- The user wants a **code health check** or asks about documentation gaps
- Identifying which files need documentation attention
- Prioritizing technical debt reduction efforts
- The user asks "which files are risky?" or "where is our documentation lacking?"
- During sprint planning to surface maintenance priorities

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | No | Directory to scan (defaults to entire repo) |
| `contributorThreshold` | number | No | Min unique contributors to flag (default: 20, min: 1) |
| `docStalenessMonths` | number | No | Months since last doc update to consider stale (default: 6, min: 1) |
| `analysisPeriodMonths` | number | No | Period for churn calculation (default: 12, min: 3) |

### Result Structure: `ShadowDebtReport`

```
{
  analyzedFiles: number;           // Total files scanned
  analysisPeriod: { start, end };  // Time window used for analysis
  riskZones: ArchaeologicalRiskZone[];
}
```

Each `ArchaeologicalRiskZone` contains:
- `filePath` — Full path to the flagged file
- `uniqueContributors` — Number of distinct contributors in the analysis period
- `lastDocumentationUpdate` — Date of last doc change, or `null` if never documented
- `churnScore` — Weighted sum of contributors and commit frequency
- `analysisPeriodMonths` — The period used for this file's analysis

### Interpreting Results

- **riskZones**: Files classified as Archaeological Risk Zones — high contributor count AND stale documentation
- A high churn score combined with many contributors signals knowledge fragmentation — no single person fully understands the file
- `lastDocumentationUpdate: null` means no documentation changes were ever detected in the file's history — this is the most critical case
- Files with both high churn AND null documentation are the highest priority for documentation efforts

### Classification Criteria

A file becomes an Archaeological Risk Zone when BOTH conditions are met:
1. **Unique contributors** exceed the configured threshold (default: 20)
2. **Documentation** has not been updated within the configured staleness period (default: 6 months)

The Churn Score is calculated as a deterministic weighted sum of:
- Number of unique contributors to the file
- Number of commits modifying the file within the analysis period

### Configuring Thresholds

- **Lower `contributorThreshold`** (e.g., 5) for smaller teams or repos — surfaces more files
- **Raise `contributorThreshold`** (e.g., 50) for large monorepos — focuses on the most critical hotspots
- **Lower `docStalenessMonths`** (e.g., 3) for fast-moving codebases where docs go stale quickly
- **Raise `analysisPeriodMonths`** (e.g., 24) to capture longer-term churn patterns

Use the `configure` tool to persist threshold changes across sessions:
```
configure({ settings: { contributorThreshold: 10, docStalenessMonths: 3 } })
```

### Error Conditions

- **Insufficient history (<3 months)**: Tool will inform you — relay this to the user. No classifications are generated.
- **Invalid thresholds**: Values below minimums are rejected with an error indicating the minimum accepted value.
- **No risk zones found**: All files are within acceptable parameters — this is a positive signal.

## When to Use `ask_oracle`

Use this tool when:

- The user asks **historical questions** about the codebase evolution
- Understanding why a pattern exists or when a dependency was introduced
- Investigating who made specific changes and why
- The user asks "when did we add X?" or "why do we use Y?" or "who last refactored Z?"
- Following up on risk zones identified by `detect_shadow_debt`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | Yes | Natural language question (max 500 characters) |

### Result Structure: `OracleResponse`

```
{
  answer: string;                  // Factual response backed by git history
  references: OracleReference[];   // Supporting evidence
  confidence: 'high' | 'medium' | 'low';
}
```

Each `OracleReference` contains:
- `type` — `"commit"`, `"pr"`, `"file"`, or `"ticket"`
- `identifier` — The specific SHA, PR number, file path, or ticket ID
- `description` — Brief explanation of how this reference supports the answer

### Interpreting Results

- **confidence: "high"** — Strong matches in the Knowledge Graph; answer is well-supported
- **confidence: "medium"** — Partial matches; answer is likely correct but may be incomplete
- **confidence: "low"** — Limited data available; suggest the user verify manually
- **references**: Every factual claim is backed by at least one reference — present these to the user for verification
- If confidence is low, mention this to the user and suggest they check the referenced commits directly

### What the Oracle Can Answer

- When a dependency was introduced or removed
- Who made a specific change and why
- Why a particular code pattern exists
- When the last refactoring of a module occurred
- Historical contributor patterns for a file
- What tickets/issues drove specific changes

### What the Oracle Cannot Answer

- Questions unrelated to the repository's git history
- Predictions about future changes
- Questions about code that was never committed
- Questions exceeding 500 characters (will be rejected)

### Error Conditions

- **Input too long (>500 chars)**: Question is rejected — ask the user to shorten it
- **Knowledge Graph not ready**: Graph is still building — tell the user to wait for indexation to complete
- **No results found**: No relevant commits, PRs, or files match the question — suggest alternative sources
- **Out-of-scope question**: Question isn't about repository history — inform the user about the tool's scope

## Recommended Workflow

1. **Detect debt** — Run `detect_shadow_debt` on the target directory (or full repo) to identify risk zones.
2. **Investigate risk zones** — For each flagged file, use `ask_oracle` to understand its history: "Why has [file] had so many contributors?" or "When was [file] last documented?"
3. **Suggest documentation actions** — Based on the oracle's answers, recommend specific actions:
   - Add inline documentation explaining the file's purpose and key decisions
   - Create or update a README for the module
   - Add architectural decision records (ADRs) for complex patterns
4. **Track progress** — Re-run `detect_shadow_debt` after documentation efforts to verify improvement.

### Example Sequence

```
User: "What's the state of our technical debt?"

1. Call detect_shadow_debt({ path: "src/", contributorThreshold: 10 })
   → Returns 3 risk zones: auth/validator.ts, payments/processor.ts, core/router.ts

2. Present findings:
   "Found 3 Archaeological Risk Zones:
    - src/auth/validator.ts (25 contributors, no docs in 14 months, churn: 87)
    - src/payments/processor.ts (18 contributors, no docs ever, churn: 72)
    - src/core/router.ts (12 contributors, docs stale 8 months, churn: 65)"

3. Call ask_oracle({ question: "Why has src/auth/validator.ts had so many contributors?" })
   → Returns: "validator.ts has been modified by 25 contributors primarily due to
      3 security incidents (SEC-101, SEC-145, SEC-203) that required emergency patches
      from multiple team members."

4. Recommend: "The auth validator has been a hotspot due to security incidents.
   Consider adding comprehensive inline documentation explaining the security
   constraints and edge cases handled by this file."
```

## Tips

- Use `detect_shadow_debt` periodically (e.g., start of each sprint) to catch new risk zones early.
- Combine with `analyze_intent` (see `git-intent-workflow.md`) on specific functions within risk zones for deeper understanding.
- When the oracle returns low-confidence answers, suggest the user check the referenced commits directly.
- Frame debt detection results positively — these are opportunities for improvement, not blame.
- For large repos, scope the scan to specific directories to get faster, more actionable results.
- Use `get_excavation_card` on risk zone files to get a quick overview of their history before diving deeper.
- The oracle works best with specific questions. Instead of "tell me about this file", ask "when was the last major refactor of src/auth/validator.ts?"

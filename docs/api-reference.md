# API Reference — Archeology Power

## Protocol

The Archeology server communicates via **MCP (Model Context Protocol)** over **stdio** transport. All tools follow the JSON-RPC 2.0 standard.

---

## MCP Tools

### `analyze_intent`

Analyzes the historical intent behind a range of lines using git blame.

**Input Schema:**

```json
{
  "file": { "type": "string", "required": true },
  "startLine": { "type": "integer", "minimum": 1, "required": true },
  "endLine": { "type": "integer", "minimum": 1, "required": true }
}
```

**Output: `IntentAnalysisResult`**

```typescript
{
  file: string;
  lineRange: { start: number; end: number };
  commits: CommitIntent[];  // max 10, ordered most-recent-first
  summary: string;          // ≤500 chars
}
```

**`CommitIntent`:**

```typescript
{
  sha: string;
  author: string;
  date: string;
  message: string;
  naturalLanguageSummary: string;  // ≤500 chars
  pullRequest?: { number: number; title: string };
  discussionSummary?: string;      // ≤300 chars
  issueRefs: string[];
}
```

---

### `detect_shadow_debt`

Detects hidden technical debt by identifying files with high churn and stale documentation.

**Input Schema:**

```json
{
  "path": { "type": "string", "optional": true },
  "contributorThreshold": { "type": "integer", "minimum": 1, "optional": true },
  "docStalenessMonths": { "type": "integer", "minimum": 1, "optional": true },
  "analysisPeriodMonths": { "type": "integer", "minimum": 3, "optional": true }
}
```

**Output: `ShadowDebtReport`**

```typescript
{
  analyzedFiles: number;
  analysisPeriod: { start: string; end: string };
  riskZones: ArchaeologicalRiskZone[];
}
```

**`ArchaeologicalRiskZone`:**

```typescript
{
  filePath: string;
  uniqueContributors: number;
  lastDocumentationUpdate: string | null;
  churnScore: number;
  analysisPeriodMonths: number;
}
```

---

### `ask_oracle`

Answers natural language questions about the repository's historical evolution.

**Input Schema:**

```json
{
  "question": { "type": "string", "maxLength": 500, "required": true }
}
```

**Output: `OracleResponse`**

```typescript
{
  answer: string;
  references: OracleReference[];
  confidence: 'high' | 'medium' | 'low';
}
```

**`OracleReference`:**

```typescript
{
  type: 'commit' | 'pr' | 'file' | 'ticket';
  identifier: string;
  description: string;
}
```

**Errors:**
- Input > 500 characters → rejected
- Knowledge Graph not ready → informative message
- No results → suggests alternative sources
- Out-of-scope question → scope limitation message

---

### `get_excavation_card`

Generates a historical card for old files (>2 years, ≥2 commits).

**Input Schema:**

```json
{
  "file": { "type": "string", "required": true }
}
```

**Output: `ExcavationCard | null`**

```typescript
{
  file: string;
  originalAuthor: string;
  currentMaintainer: string;
  lastMajorRefactor: { date: string; commitSha: string } | null;
  cyclomaticComplexity: number | null;
  fileAge: string;
  fieldsUnavailable: string[];
}
```

Returns `null` (with informative message) if the file doesn't meet criteria.

---

### `check_refactor_safety`

Checks whether deleting a block of code is safe by analyzing its history.

**Input Schema:**

```json
{
  "file": { "type": "string", "required": true },
  "startLine": { "type": "integer", "minimum": 1, "required": true },
  "endLine": { "type": "integer", "minimum": 1, "required": true }
}
```

**Output: `RefactorSafetyResult`**

```typescript
{
  safe: boolean;
  warnings: RefactorWarning[];
  analysisCompleted: boolean;
}
```

**`RefactorWarning`:**

```typescript
{
  caseId: string;
  description: string;
  commitSha: string;
  prNumber?: number;
  severity: 'high' | 'medium';
}
```

---

### `run_migration_scout`

Generates a migration readiness report for a module.

**Input Schema:**

```json
{
  "path": { "type": "string", "required": true }
}
```

**Output: `MigrationReport`**

```typescript
{
  modulePath: string;
  totalFiles: number;
  categories: {
    safeToMigrate: MigrationFileEntry[];
    requiresInvestigation: MigrationFileEntry[];
    doNotMigrate: MigrationFileEntry[];
  };
  executiveSummary: {
    totalAnalyzed: number;
    distribution: { safe: number; investigate: number; doNotMigrate: number };
    topRiskFiles: RiskFileEntry[];  // top 5
  };
  historyConfidence: 'high' | 'limited';
}
```

**`MigrationFileEntry`:**

```typescript
{
  path: string;
  category: 'safe' | 'investigate' | 'do-not-migrate';
  reason: string;
  logicalDependencies?: string[];
  securityPatches?: string[];
  riskScore?: number;
}
```

---

### `get_logical_coupling`

Analyzes logical coupling for a file based on commit co-occurrence.

**Input Schema:**

```json
{
  "file": { "type": "string", "required": true },
  "coOccurrenceThreshold": { "type": "number", "minimum": 0.50, "maximum": 1.0, "optional": true },
  "analysisPeriodMonths": { "type": "integer", "minimum": 3, "optional": true }
}
```

**Output: `LogicalCouplingResult`**

```typescript
{
  file: string;
  coupledFiles: CoupledFile[];  // max 20, ordered by co-occurrence desc
  analysisperiod: { start: string; end: string };
}
```

**`CoupledFile`:**

```typescript
{
  path: string;
  coOccurrencePercentage: number;
  sharedCommits: number;
  recentSharedCommits: { sha: string; date: string; message: string }[];  // max 3
}
```

---

### `get_graph_status`

Returns the current state of the Knowledge Graph.

**Input Schema:**

```json
{}
```

**Output: `GraphStatus`**

```typescript
{
  state: 'building' | 'ready' | 'error' | 'not-initialized';
  progress?: { processed: number; total: number };
  lastUpdated: string | null;
  totalNodes: { files: number; commits: number; authors: number; tickets: number };
  error?: string;
}
```

---

### `configure`

Updates power configuration with validation.

**Input Schema:**

```json
{
  "settings": {
    "type": "object",
    "properties": {
      "contributorThreshold": { "type": "integer" },
      "docStalenessMonths": { "type": "integer" },
      "analysisPeriodMonths": { "type": "integer" },
      "coOccurrenceThreshold": { "type": "number" },
      "couplingAnalysisPeriodMonths": { "type": "integer" },
      "fileAgeThresholdYears": { "type": "number" },
      "deletionLineThreshold": { "type": "integer" },
      "externalLlm": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean" },
          "endpoint": { "type": "string" },
          "apiKey": { "type": "string" }
        },
        "required": ["enabled", "endpoint", "apiKey"]
      }
    },
    "required": true
  }
}
```

**Output:**

```typescript
{ success: true; config: ArcheologyConfig }
// or on error:
{ error: "Configuration rejected: ..." }
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| Response with `isError: true` | Validation failed or operation error |
| Timeout (no response) | Operation exceeded time limit |
| Connection closed (-32000) | Server crashed (check stderr logs) |

## Recognized Ticket Patterns

The ticket extractor recognizes these patterns in commit messages:

| Pattern | Example | Regex |
|---------|---------|-------|
| JIRA-style | `PROJ-123`, `AUTH-456` | `[A-Z][A-Z0-9]+-\d+` |
| GitHub issues | `#123`, `#456` | `#\d+` |
| Two-letter prefix | `GH-789`, `AB-12` | `[A-Z]{2}-\d+` |

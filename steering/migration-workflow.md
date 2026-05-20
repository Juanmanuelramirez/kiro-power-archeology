# Migration Workflow

Guide for planning module migrations and understanding hidden dependencies using the Archeology Power.

## Tools Covered

- `run_migration_scout` — Generates a migration readiness report for a directory or module
- `get_logical_coupling` — Reveals invisible dependencies between files based on change history

## When to Use `run_migration_scout`

Use this tool when:

- The user is planning to **migrate** a module to a new service, package, or monorepo
- Assessing migration risk before splitting a codebase
- The user asks "what's safe to move?" or "what are the risks of extracting this module?"
- Creating a migration plan or roadmap for a legacy system

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to the directory or module to analyze |

### Result Structure: `MigrationReport`

```
{
  modulePath: string;              // The analyzed directory path
  totalFiles: number;              // Total files in the module
  categories: {
    safeToMigrate: MigrationFileEntry[];
    requiresInvestigation: MigrationFileEntry[];
    doNotMigrate: MigrationFileEntry[];
  };
  executiveSummary: {
    totalAnalyzed: number;
    distribution: { safe, investigate, doNotMigrate };
    topRiskFiles: RiskFileEntry[];  // Top 5 by risk score
  };
  historyConfidence: 'high' | 'limited';
}
```

Each `MigrationFileEntry` contains:
- `path` — File path relative to repo root
- `category` — `"safe"`, `"investigate"`, or `"do-not-migrate"`
- `reason` — Human-readable explanation of the classification
- `logicalDependencies` — Array of coupled file paths (for "investigate" files)
- `securityPatches` — Array of security-related commit references (for "investigate" files)
- `riskScore` — Numeric risk score based on churn and age (for "investigate" files)

Each `RiskFileEntry` contains:
- `path` — File path
- `riskScore` — Numeric risk score
- `justification` — Why this file is high-risk

### Interpreting Results

The report classifies every file into one of three categories:

| Category | Meaning | Action |
|----------|---------|--------|
| **Safe to migrate** | No hidden dependencies or critical patches | Can be moved with confidence |
| **Requires investigation** | Has logical couplings or security patches | Review dependencies before moving |
| **Do not migrate** | Dead code (no invocations/modifications in 24 months) | Should be removed, not migrated |

Key fields to check:

- **historyConfidence**: `"high"` if ≥6 months of history, `"limited"` otherwise — flag this to the user
- **executiveSummary.topRiskFiles**: The 5 most dangerous files to migrate — always present these
- **executiveSummary.distribution**: Quick overview of the migration landscape

### Classification Logic

- **"do-not-migrate"**: File has no invocations (static analysis) AND no modifications in 24 months → dead code
- **"investigate"**: File has logical dependencies (co-occurrence >70%) OR security patches in its history
- **"safe"**: No hidden dependencies and no critical patches detected

### Presenting the Executive Summary

When sharing results with the user:

1. Lead with the distribution: "X files safe, Y need investigation, Z are dead code"
2. Highlight the top risk files with their justifications
3. If confidence is "limited", caveat the results: "Note: less than 6 months of git history available — classifications may be less reliable"
4. For "investigate" files, mention their logical dependencies and any security patches found

### Error Conditions

- **Timeout (60s)**: Module has too many files — suggest breaking into subdirectories
- **Insufficient history (<6 months)**: Report generated with `historyConfidence: "limited"`
- **No git history**: Cannot generate report — inform the user

## When to Use `get_logical_coupling`

Use this tool when:

- The user wants to understand **hidden dependencies** between files
- Before splitting a module — to find files that always change together
- When a migration report flags files as "requires investigation" and you need details
- The user asks "what else changes when I modify this file?"
- When planning coordinated changes across multiple files

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file to analyze |
| `coOccurrenceThreshold` | number | No | Minimum co-occurrence ratio (default: 0.70, min: 0.50) |
| `analysisPeriodMonths` | number | No | Months of history to analyze (default: 12, min: 3) |

### Result Structure: `LogicalCouplingResult`

```
{
  file: string;                    // The analyzed file
  coupledFiles: CoupledFile[];     // Ordered by co-occurrence descending, max 20
  analysisperiod: { start, end };  // The time window analyzed
}
```

Each `CoupledFile` contains:
- `path` — Path of the coupled file
- `coOccurrencePercentage` — How often they change together (percentage)
- `sharedCommits` — Total number of commits modifying both files
- `recentSharedCommits` — The 3 most recent commits where both were modified (sha, date, message)

### Interpreting Results

- **High co-occurrence (>80%)**: Files are almost always modified together — migrating one without the other is risky
- **Medium co-occurrence (70-80%)**: Strong coupling — investigate whether the dependency is structural or coincidental
- **At threshold (50-70%)**: Moderate coupling — may be safe to separate with careful testing
- If no couplings are found above the threshold, inform the user that no significant logical dependencies were detected

### Co-occurrence Calculation

The ratio is calculated as:
```
co-occurrence = shared_commits / total_commits_affecting_either_file
```

Where:
- `shared_commits` = commits that modify BOTH files
- `total_commits_affecting_either_file` = commits that modify file A OR file B (within the analysis period)

### Error Conditions

- **No couplings found**: File has no significant dependencies above the threshold — this is a positive signal for migration
- **File not tracked**: The file has no git history
- **Timeout (15s)**: Analysis took too long — suggest a shorter analysis period

## Recommended Workflow

1. **Run scout on the target module** — Call `run_migration_scout` with the directory path to get the full classification report.
2. **Review the executive summary** — Present the distribution and top risk files to the user.
3. **Investigate flagged files** — For each file classified as "requires investigation", examine the listed dependencies and security patches.
4. **Check couplings for risky files** — Call `get_logical_coupling` on high-risk files to understand exactly which other files they're tied to.
5. **Present a migration plan** — Summarize: what's safe to move now, what needs coordinated migration (coupled files), and what should be deleted first (dead code).

### Example Sequence

```
User: "I want to extract the payments module into its own service"

1. Call run_migration_scout({ path: "src/payments" })
   → Returns: 12 safe, 4 investigate, 2 do-not-migrate

2. Present executive summary:
   "12 files are safe to migrate. 4 need investigation (coupled to billing module).
    2 files are dead code — recommend removing before migration."

3. For the top risk file, call get_logical_coupling({ file: "src/payments/processor.ts" })
   → Returns: 85% co-occurrence with src/billing/invoice.ts

4. Advise: "processor.ts and invoice.ts change together 85% of the time.
   Consider migrating both together or establishing a clear API boundary."
```

## Tips

- Start broad with `run_migration_scout`, then drill down with `get_logical_coupling` on specific files.
- Files with high logical coupling should be migrated together — suggest this to the user.
- Dead code ("do not migrate") is a cleanup opportunity. Suggest removing it before migration to reduce scope.
- If the user lowers the co-occurrence threshold, more couplings will appear — useful for thorough analysis but may include noise.
- The 60-second timeout applies to modules up to 1000 files. For larger modules, suggest breaking the analysis into subdirectories.
- Combine with `detect_shadow_debt` (see `shadow-debt-workflow.md`) to identify files that need documentation before migration.
- Use `check_refactor_safety` (see `git-intent-workflow.md`) before removing dead code flagged by the scout.

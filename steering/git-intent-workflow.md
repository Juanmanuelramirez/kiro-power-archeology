# Git Intent Workflow

Guide for understanding code intent and ensuring safe refactoring using the Archeology Power.

## Tools Covered

- `analyze_intent` — Reveals the historical intent behind specific lines of code
- `check_refactor_safety` — Warns before deleting code tied to bug fixes or edge cases

## When to Use `analyze_intent`

Use this tool when:

- The user asks **why** a piece of code exists or what problem it solves
- Before refactoring legacy code to understand the original author's reasoning
- When investigating a function that has no inline documentation
- When the user wants to know who introduced a change and what ticket/PR drove it
- When onboarding to an unfamiliar module and needing historical context

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file relative to repo root |
| `startLine` | number | Yes | First line of the range to analyze (1-indexed) |
| `endLine` | number | Yes | Last line of the range (max 500 lines from startLine) |

### Result Structure: `IntentAnalysisResult`

```
{
  file: string;                    // The analyzed file path
  lineRange: { start, end };       // The line range analyzed
  commits: CommitIntent[];         // Ordered most-recent-first, max 10
  summary: string;                 // Natural language explanation (≤500 chars)
}
```

Each `CommitIntent` contains:
- `sha` — Commit hash
- `author` — Author name
- `date` — Commit date
- `message` — Full commit message
- `naturalLanguageSummary` — Human-readable explanation (≤500 chars)
- `pullRequest` — `{ number, title }` if a PR is associated (optional)
- `discussionSummary` — Summary of PR comments/discussions (≤300 chars, optional)
- `issueRefs` — Array of referenced issue/ticket identifiers

### Interpreting Results

- **commits**: Ordered most-recent-first, max 10. Each includes author, date, message, and optional PR/issue references.
- **summary**: A natural language explanation (≤500 chars) of why the code was written.
- If a commit has a `pullRequest` field, present the PR number and title to the user for additional context.
- If `discussionSummary` is present, it contains key points from PR comments or linked issues.
- If `issueRefs` is non-empty, these are ticket identifiers (JIRA-123, #456, etc.) that provide traceability.
- If a commit has no PR or issue reference, only the commit message and author are available — mention this to the user.
- If no history is found, inform the user the file may be untracked or too new.

### Error Conditions

- **File not tracked**: The file has no git history — inform the user.
- **Insufficient history**: The file exists but has no commits for the selected lines.
- **Timeout (10s)**: Analysis took too long — inform the user and suggest a smaller line range.

## When to Use `check_refactor_safety`

Use this tool when:

- The user is about to **delete** a block of code (especially >10 lines)
- During refactoring sessions where legacy code is being removed or rewritten
- When the user asks "is it safe to remove this?"
- Before suggesting code deletions in a refactoring plan

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file relative to repo root |
| `startLine` | number | Yes | First line of the block being considered for removal |
| `endLine` | number | Yes | Last line of the block being considered for removal |

### Result Structure: `RefactorSafetyResult`

```
{
  safe: boolean;                   // true if no warnings detected
  warnings: RefactorWarning[];     // List of detected risks
  analysisCompleted: boolean;      // false if timeout or partial analysis
}
```

Each `RefactorWarning` contains:
- `caseId` — Identifier for the referenced bug/edge case (e.g., ticket ID)
- `description` — What problem the code was solving
- `commitSha` — The commit that introduced the fix
- `prNumber` — PR number if available (optional)
- `severity` — `"high"` or `"medium"`

### Interpreting Results

- **safe: true** — No historical associations with bug fixes or edge cases found. Proceed with confidence.
- **safe: false** — Warnings detected. Present each warning to the user before proceeding.
- **analysisCompleted: false** — The check timed out or couldn't fully analyze. Inform the user but don't block them.
- **High severity**: Code directly tied to a documented bug fix. Strongly advise the user to review before deleting.
- **Medium severity**: Code associated with edge-case keywords but without a direct issue reference.

### Detection Logic

The tool flags code when commits that introduced the lines contain:
- Bug/fix keywords: "fix", "bug", "edge case", "hotfix", "patch"
- Issue/ticket references: JIRA-123, #456, GH-789
- PR references linking to bug reports

Only blocks of more than 10 consecutive deleted lines trigger the analysis.

### Error Conditions

- **Timeout (5s)**: Analysis couldn't complete — `analysisCompleted` will be `false`. Allow the user to proceed.
- **No git history**: File is untracked or too new — `analysisCompleted` will be `false`.

## Recommended Workflow

1. **Analyze intent first** — When the user is exploring or about to modify legacy code, call `analyze_intent` on the relevant lines to surface historical context.
2. **If refactoring** — Before any deletion of substantial code blocks (>10 lines), call `check_refactor_safety` on the lines being removed.
3. **Present warnings clearly** — If warnings are returned, show the user the case ID, description, and link to the original commit/PR. Let them decide whether to proceed.
4. **Never block the user** — If the safety check times out or history is unavailable, inform the user that the check couldn't complete but allow them to proceed.

### Example Sequence

```
User: "I want to refactor this function on lines 45-80 of src/auth/validator.ts"

1. Call analyze_intent({ file: "src/auth/validator.ts", startLine: 45, endLine: 80 })
   → Shows 3 commits: one bug fix (JIRA-AUTH-234), one feature addition, one refactor

2. Call check_refactor_safety({ file: "src/auth/validator.ts", startLine: 45, endLine: 80 })
   → Returns safe: false, warning: "Lines 52-67 fix edge case JIRA-AUTH-234 (null token handling)"

3. Present warning to user: "⚠️ Lines 52-67 were introduced to fix JIRA-AUTH-234 (null token handling in OAuth flow). Review before removing."
```

## Tips

- Combine both tools in sequence: intent gives context, safety check gives risk assessment.
- For small changes (<10 lines), `analyze_intent` alone is usually sufficient — the safety check only triggers on >10 line deletions.
- If the user dismisses a warning, respect their decision — the tool is advisory, not blocking.
- When presenting intent results, highlight the most recent commit first as it's typically the most relevant context.
- For files in Shadow Debt risk zones (see `shadow-debt-workflow.md`), always run both tools before suggesting changes.
- Use `get_excavation_card` first on unfamiliar files to get a high-level overview before diving into specific line ranges with `analyze_intent`.

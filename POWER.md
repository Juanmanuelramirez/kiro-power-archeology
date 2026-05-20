---
name: "archeology"
displayName: "Archeology"
description: "Historical intelligence for legacy code repositories. Analyze Git evolution to recover author intent, detect hidden technical debt, and facilitate safe migrations."
keywords: ["archeology", "legacy", "git", "history", "migration", "debt", "knowledge-graph", "intent", "coupling", "blame", "refactor"]
author: "Juan Ramirez"
---

# Archeology

Historical intelligence for legacy code repositories.

Archeology is a Kiro Power that provides historical intelligence about legacy code repositories. Unlike static analysis tools that evaluate the current state of code, Archeology analyzes the temporal evolution of a repository through Git to recover author intent, detect hidden technical debt, and facilitate safe migrations.

All processing runs locally on your machine. No code or repository data is sent externally unless you explicitly configure an authorized external LLM for Oracle Chat.

## Onboarding

Archeology works automatically once installed:

1. **Auto-detection**: The power detects the Git repository in your workspace by finding the `.git` directory closest to the workspace root.
2. **Background indexing**: On first use, a Knowledge Graph is built in the background by processing your Git history. This connects files, commits, authors, and tickets into a queryable graph stored locally as SQLite.
3. **Incremental updates**: After the initial build, only new commits are processed — no full rebuilds needed.
4. **Immediate availability**: Tools that don't depend on the full Knowledge Graph (like `analyze_intent` and `check_refactor_safety`) work immediately while the graph is building.

No manual configuration is required. Optional settings (thresholds, analysis periods) can be adjusted via the `configure` tool.

## Tools

| Tool | Description |
|------|-------------|
| `analyze_intent` | Analyze the historical intent behind a range of lines using git blame. Returns commits grouped by unique SHA, ordered most recent first, with natural language summaries. |
| `detect_shadow_debt` | Detect shadow technical debt by identifying files with high contributor churn and stale documentation. Classifies files as Archaeological Risk Zones. |
| `ask_oracle` | Ask questions in natural language about the historical evolution of the repository. Queries the Knowledge Graph and returns factual answers backed by references. |
| `get_excavation_card` | Generate an Excavation Card with historical context for a file older than 2 years with at least 2 commits. |
| `check_refactor_safety` | Check if deleting a range of lines is safe by analyzing git history for associations with bug fixes or edge cases. |
| `run_migration_scout` | Generate a migration readiness report classifying files as safe, requires-investigation, or do-not-migrate. |
| `get_logical_coupling` | Analyze logical coupling for a file by identifying other files frequently modified together in commits. |
| `get_graph_status` | Get the current state of the Knowledge Graph (building, ready, error, or not-initialized). |
| `configure` | Update Archeology Power configuration settings with validation against minimum constraints. |

## Steering Files

| File | Purpose |
|------|---------|
| `steering/git-intent-workflow.md` | Guidance for using `analyze_intent` and `check_refactor_safety` to understand code history and safely refactor legacy code. |
| `steering/migration-workflow.md` | Guidance for using `run_migration_scout` and `get_logical_coupling` to plan and execute safe code migrations. |
| `steering/shadow-debt-workflow.md` | Guidance for using `detect_shadow_debt` and `ask_oracle` to identify and investigate hidden technical debt. |

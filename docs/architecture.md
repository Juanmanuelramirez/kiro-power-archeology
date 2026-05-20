# Architecture — Archeology Power

## Overview

Archeology is a Kiro Power implemented as an MCP (Model Context Protocol) server in TypeScript. It analyzes the temporal evolution of Git repositories to recover author intent, detect hidden technical debt, and facilitate safe migrations.

```
┌─────────────────────────────────────────────────────────────┐
│                        Kiro IDE                             │
│                                                             │
│  ┌──────────┐    MCP (stdio)    ┌────────────────────────┐ │
│  │Kiro Agent│◄──────────────────►│ Archeology MCP Server │ │
│  └──────────┘                    └───────────┬────────────┘ │
│                                              │              │
└──────────────────────────────────────────────┼──────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────┐
                    │         Data Layer        │                  │
                    │                          ▼                  │
                    │  ┌──────────────┐  ┌──────────────────┐    │
                    │  │  Git CLI     │  │  Knowledge Graph │    │
                    │  │  Adapter     │  │  (SQLite)        │    │
                    │  └──────┬───────┘  └──────────────────┘    │
                    │         │                                    │
                    │         ▼                                    │
                    │  ┌──────────────┐                           │
                    │  │ Local Git    │                           │
                    │  │ Repository   │                           │
                    │  └──────────────┘                           │
                    └─────────────────────────────────────────────┘
```

## Design Principles

| Principle | Description |
|-----------|-------------|
| **Local-First** | All processing happens on the user's machine. No data is sent externally without explicit authorization. |
| **Non-Blocking** | The MCP server is available immediately. The Knowledge Graph builds in the background. |
| **Incremental** | Only new commits are processed — no full graph rebuilds. |
| **Graceful Degradation** | If data is unavailable, the user is informed without blocking their workflow. |

## Main Components

### 1. Entry Point (`src/index.ts`)

Responsibilities:
- Detect the Git repository closest to the workspace root
- Initialize dependencies (GitAdapter, SqliteStore, GraphBuilder)
- Connect the MCP server to the stdio transport
- Trigger Knowledge Graph background build
- Handle graceful shutdown (SIGINT, SIGTERM)

### 2. MCP Server (`src/server.ts`)

Responsibilities:
- Register all 9 MCP tools with their validation schemas (via Zod)
- Route tool calls to the appropriate handlers
- Maintain configuration state in memory

### 3. Git CLI Adapter (`src/core/git-adapter.ts`)

Unified interface over the Git CLI. Uses `child_process.execFile` to run Git commands with timeout support.

Main operations:
- `blame()` — Get per-line authorship
- `log()` — Commit history with filters
- `logFollow()` — History with rename tracking
- `show()` — Specific commit details
- `diffStat()` / `numstat()` — Change statistics
- `getNewCommits()` — Incremental commits since a SHA

### 4. Knowledge Graph Builder (`src/core/graph-builder.ts`)

Builds and maintains the knowledge graph:
- `initialize()` — Detects previous state (resumes if exists)
- `buildInitial()` — Processes all commits in batches of 50
- `updateIncremental()` — Processes only new commits
- Rename tracking via `git log --follow`

### 5. SQLite Store (`src/storage/sqlite-store.ts`)

Knowledge Graph persistence in SQLite (file: `.git/archeology.db`).

Tables:
- `files` — Repository files
- `commits` — Processed commits
- `authors` — Unique authors
- `tickets` — Tickets extracted from commit messages
- `commit_files` — Commit↔file relationship
- `commit_tickets` — Commit↔ticket relationship
- `file_renames` — Rename history
- `logical_couplings` — Calculated logical couplings

### 6. Analysis Tools (`src/tools/`)

| Module | MCP Tool | Function |
|--------|----------|----------|
| `git-intent.ts` | `analyze_intent` | Historical intent behind lines of code |
| `shadow-debt.ts` | `detect_shadow_debt` | Hidden technical debt detection |
| `oracle-chat.ts` | `ask_oracle` | Natural language questions about the repo |
| `excavation-card.ts` | `get_excavation_card` | Historical card for old files |
| `pre-refactor-check.ts` | `check_refactor_safety` | Pre-refactor safety verification |
| `migration-scout.ts` | `run_migration_scout` | Migration readiness report |
| `logical-coupling.ts` | `get_logical_coupling` | Logical coupling map |

### 7. Support Modules (`src/core/`)

| Module | Function |
|--------|----------|
| `churn-calculator.ts` | Churn Score calculation (weighted sum of contributors and commits) |
| `ticket-extractor.ts` | Ticket extraction from commit messages (JIRA, GitHub, etc.) |

## Data Flow

### Initialization

```
1. main() → findGitRepo(workspaceRoot)
2. GitCliAdapter(repoRoot)
3. SqliteStore(.git/archeology.db)
4. GraphBuilder.initialize(repoRoot)
5. createServer(deps) → server.connect(StdioServerTransport)
6. GraphBuilder.buildInitial() [background, no await]
```

### Tool Query

```
1. Kiro Agent → MCP request (tools/call)
2. Server tool router → specific handler
3. Handler → GitAdapter / SqliteStore
4. Result → JSON response to Agent
```

### Incremental Update

```
1. GraphBuilder.updateIncremental()
2. git.getNewCommits(lastKnownSha)
3. Process batch of new commits
4. Update SQLite (nodes + relationships)
```

## Data Model (ER)

```
AUTHORS ──1:N──► COMMITS ──N:M──► FILES
                    │
                    └──N:M──► TICKETS

FILES ──1:N──► FILE_RENAMES
FILES ──N:M──► LOGICAL_COUPLINGS
```

## Error Handling

| Category | Strategy |
|----------|----------|
| Git unavailable | Disable analysis, inform user |
| Insufficient history (<3 months) | Partial analysis with limited confidence indicator |
| Timeout | Return partial results or allow operation without blocking |
| Graph not ready | Graph-independent tools work; dependent ones report status |
| Invalid configuration | Reject with clear error, preserve previous config |

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (ES2022, NodeNext) |
| Runtime | Node.js ≥ 18 |
| Protocol | MCP (Model Context Protocol) via stdio |
| Database | SQLite (better-sqlite3) |
| Testing | Vitest + fast-check (property-based) |
| Git | Native CLI (child_process.execFile) |

# Archeology Power

> Historical intelligence for legacy code repositories.

Archeology is a [Kiro Power](https://kiro.dev) that analyzes the temporal evolution of Git repositories to recover author intent, detect hidden technical debt, and facilitate safe migrations. All processing is local — no data is sent to external servers.

## Features

| Tool | Description |
|------|-------------|
| **Git Intent Analyzer** | Reveals why a block of code exists by analyzing commits, PRs, and discussions |
| **Shadow Debt Detector** | Identifies files with high contributor churn and stale documentation |
| **Oracle Chat** | Answers natural language questions about the repository's evolution |
| **Excavation Card** | Automatic historical card for old files (>2 years) |
| **Pre-Refactor Safety** | Warns before deleting code associated with bug fixes |
| **Migration Scout** | Migration readiness report with risk classification |
| **Logical Coupling Map** | Detects invisible dependencies between files based on parallel changes |

## Quick Start

### Requirements

- Node.js ≥ 18
- Git ≥ 2.25
- Kiro IDE

### Installation

```bash
git clone https://github.com/your-user/kiro-power-archeology.git
cd kiro-power-archeology
npm install
npm run build
```

Then configure the power in your workspace (`.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "archeology": {
      "command": "node",
      "args": ["/absolute/path/to/kiro-power-archeology/dist/index.js"],
      "env": {}
    }
  }
}
```

### Usage

Once installed, Archeology works automatically:

1. Detects the Git repository in your workspace
2. Builds a Knowledge Graph in the background (local SQLite)
3. Tools are available to the Kiro agent immediately

Example interactions with the agent:

```
"Why does this function exist in src/auth/validator.ts lines 45-80?"
"Which files have the most technical debt?"
"Is it safe to remove lines 52-80 from src/payments/processor.ts?"
"I want to migrate the src/payments module — what are the risks?"
"What files always change together with src/core/router.ts?"
```

## Documentation

| Document | Content |
|----------|---------|
| [Architecture](docs/architecture.md) | Components, data flow, data model |
| [Installation](docs/installation.md) | Requirements, setup, troubleshooting |
| [Usage Guide](docs/usage.md) | Tools, parameters, examples |
| [API Reference](docs/api-reference.md) | Complete input/output schemas |
| [Development](docs/development.md) | Dev setup, testing, adding tools |

## Architecture

```
Kiro Agent ◄──MCP (stdio)──► Archeology MCP Server
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              Git CLI Adapter   Tool Handlers   Knowledge Graph
                    │                               │
              Git Repository                   SQLite (.git/archeology.db)
```

- **Local-First**: Everything runs on your machine
- **Non-Blocking**: The server is available while the graph builds
- **Incremental**: Only processes new commits after the first indexing

## Development

```bash
# Tests (307 tests, 13 files)
npm test

# Build
npm run build

# Type check
npm run lint

# Watch mode
npm run dev
```

### Stack

- TypeScript (ES2022, strict mode)
- MCP SDK (`@modelcontextprotocol/sdk`)
- SQLite (`better-sqlite3`)
- Vitest + fast-check (property-based testing)

## Configuration

Thresholds are configurable via the `configure` tool:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `contributorThreshold` | 20 | Contributors to flag as risk |
| `docStalenessMonths` | 6 | Months without docs to consider stale |
| `analysisPeriodMonths` | 12 | Churn analysis period |
| `coOccurrenceThreshold` | 0.70 | Co-occurrence threshold for coupling |

## Privacy

- All analysis is local — no data is sent externally
- The Knowledge Graph is stored in `.git/archeology.db`
- External LLM integration is optional and requires explicit confirmation
- Only metadata is sent to the LLM (never full source code)

## License

MIT

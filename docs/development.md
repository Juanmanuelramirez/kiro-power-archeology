# Development Guide — Archeology Power

## Environment Setup

### Requirements

- Node.js ≥ 18
- Git ≥ 2.25
- npm

### Initial setup

```bash
git clone https://github.com/your-user/kiro-power-archeology.git
cd kiro-power-archeology
npm install
```

### Available scripts

| Script | Command | Description |
|--------|---------|-------------|
| Build | `npm run build` | Compiles TypeScript and copies SQL migrations |
| Dev | `npm run dev` | Compilation in watch mode |
| Test | `npm test` | Runs all tests (vitest run) |
| Test watch | `npm run test:watch` | Tests in watch mode |
| Lint | `npm run lint` | Type checking (tsc --noEmit) |

## Project Structure

```
kiro-power-archeology/
├── POWER.md                    # Kiro Power metadata
├── mcp.json                    # MCP server configuration
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── steering/                   # Workflow guides for the agent
│   ├── git-intent-workflow.md
│   ├── migration-workflow.md
│   └── shadow-debt-workflow.md
├── docs/                       # Project documentation
├── src/
│   ├── index.ts                # Entry point (repo detection, init)
│   ├── server.ts               # MCP server + tool router
│   ├── types/
│   │   └── index.ts            # Shared types and interfaces
│   ├── config/
│   │   ├── defaults.ts         # Default configuration + validation
│   │   └── defaults.test.ts
│   ├── core/
│   │   ├── git-adapter.ts      # Wrapper over Git CLI
│   │   ├── git-adapter.test.ts
│   │   ├── graph-builder.ts    # Knowledge Graph constructor
│   │   ├── graph-builder.test.ts
│   │   ├── churn-calculator.ts # Churn Score calculation
│   │   ├── churn-calculator.test.ts
│   │   ├── ticket-extractor.ts # Ticket extraction
│   │   └── ticket-extractor.test.ts
│   ├── storage/
│   │   ├── sqlite-store.ts     # SQLite persistence
│   │   ├── sqlite-store.test.ts
│   │   └── migrations/
│   │       └── 001-initial-schema.sql
│   └── tools/
│       ├── git-intent.ts       # analyze_intent
│       ├── git-intent.test.ts
│       ├── shadow-debt.ts      # detect_shadow_debt
│       ├── shadow-debt.test.ts
│       ├── oracle-chat.ts      # ask_oracle
│       ├── oracle-chat.test.ts
│       ├── excavation-card.ts  # get_excavation_card
│       ├── excavation-card.test.ts
│       ├── pre-refactor-check.ts   # check_refactor_safety
│       ├── pre-refactor-check.test.ts
│       ├── migration-scout.ts  # run_migration_scout
│       ├── migration-scout.test.ts
│       ├── logical-coupling.ts # get_logical_coupling
│       └── logical-coupling.test.ts
└── dist/                       # Compiled output (generated)
```

## Testing

### Testing Strategy

The project uses two complementary approaches:

1. **Property-Based Testing** (fast-check) — Verifies universal properties that must hold for any valid input
2. **Unit Testing** (vitest) — Verifies specific behavior with concrete examples

### Running tests

```bash
# All tests
npm test

# Tests in watch mode (development)
npm run test:watch

# A specific file
npx vitest run src/tools/git-intent.test.ts

# Tests with coverage
npx vitest run --coverage
```

### Test conventions

- Test files alongside the module: `module.ts` → `module.test.ts`
- Property tests tagged with: `Feature: archeology-power, Property N: description`
- Minimum 100 iterations per property test
- Custom generators for: commit histories, blame entries, configurations

### Property test example

```typescript
import { fc } from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Feature: archeology-power, Property 3: Churn score determinism', () => {
  it('same inputs always produce same output', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100 }),  // contributors
        fc.nat({ max: 1000 }), // commits
        (contributors, commits) => {
          const score1 = calculateChurnScore(contributors, commits);
          const score2 = calculateChurnScore(contributors, commits);
          expect(score1).toBe(score2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

## Adding a New Tool

### 1. Define types in `src/types/index.ts`

```typescript
export interface MyToolResult {
  // result fields
}
```

### 2. Create the handler in `src/tools/my-tool.ts`

```typescript
export class MyTool {
  constructor(private git: GitAdapter) {}

  async execute(params: MyToolParams): Promise<MyToolResult> {
    // implementation
  }
}
```

### 3. Register in `src/server.ts`

```typescript
server.tool(
  'my_tool_name',
  'Tool description',
  { /* Zod schema */ },
  async (params) => {
    const result = await myTool.execute(params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);
```

### 4. Create tests in `src/tools/my-tool.test.ts`

### 5. Document in `POWER.md` and relevant steering files

## Database Migrations

SQL migrations are in `src/storage/migrations/` and run automatically when the store initializes.

### Adding a migration

1. Create file: `src/storage/migrations/002-my-change.sql`
2. The name must follow the pattern: `NNN-description.sql` (numeric order)
3. Migrations run in order and only once

> **Important**: The build script copies migrations to `dist/`. If you add a new one, run `npm run build`.

## Debugging

### Running the server manually

```bash
# Build
npm run build

# Run with manual input (useful for debugging)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/index.js
```

### Logs

The server writes error logs to stderr:
- `[archeology-power] No git repository found...`
- `[archeology-power] Knowledge Graph build failed: ...`
- `[archeology-power] Fatal error: ...`

### Inspecting the database

```bash
sqlite3 .git/archeology.db ".tables"
sqlite3 .git/archeology.db "SELECT COUNT(*) FROM commits;"
sqlite3 .git/archeology.db "SELECT * FROM files LIMIT 10;"
```

## Code Conventions

- TypeScript strict mode enabled
- ESM (type: "module" in package.json)
- Imports with `.js` extension (required by NodeNext)
- Interfaces over types for public objects
- Errors handled with try/catch, never uncontrolled crashes
- Timeouts on all Git operations
- No external network dependencies by default

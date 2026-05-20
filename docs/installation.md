# Installation — Archeology Power

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| Node.js | 18.0.0 | Required for the MCP server |
| Git | 2.25+ | Must be in the system PATH |
| Kiro IDE | Latest version | With Powers support |

## Installing as a Kiro Power

### Option 1: Install from local directory

1. Clone the repository:

```bash
git clone https://github.com/your-user/kiro-power-archeology.git
cd kiro-power-archeology
```

2. Install dependencies and build:

```bash
npm install
npm run build
```

3. In Kiro, open the Powers panel (Command Palette → "Configure Powers") and add the local path to the power.

### Option 2: Manual configuration in mcp.json

Add the following entry to your MCP configuration file (`.kiro/settings/mcp.json` in the workspace or `~/.kiro/settings/mcp.json` globally):

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

> **Important**: Use the absolute path to the compiled `dist/index.js` file.

## Verifying the Installation

Once installed, verify the power works:

1. Open a workspace containing a Git repository
2. In Kiro, activate the "Archeology" power
3. Use the `get_graph_status` tool — it should return the Knowledge Graph state

### Possible Knowledge Graph States

| State | Meaning |
|-------|---------|
| `not-initialized` | The power just started, hasn't processed commits yet |
| `building` | Processing Git history (first time) |
| `ready` | Graph built and ready for queries |
| `error` | Error during construction (see `error` field) |

## Troubleshooting

### Error: "Connection closed" (MCP error -32000)

**Most common cause**: SQL migration files are not in `dist/storage/migrations/`.

**Solution**:
```bash
npm run build
```

The build script automatically copies migrations. If it persists:
```bash
cp -r src/storage/migrations dist/storage/
```

### Error: "No git repository found in workspace"

The power requires a valid Git repository. Verify:
```bash
git rev-parse --git-dir
```

### The Knowledge Graph takes too long to build

For large repositories (>10,000 commits), the initial build may take several minutes. Tools that don't depend on the graph (`analyze_intent`, `check_refactor_safety`) work immediately.

### Error: "Not a valid git repository"

The `.git` directory exists but is corrupted. Verify integrity:
```bash
git fsck
```

### Error: "spawn node ENOENT"

Kiro cannot find the `node` executable in the PATH. Solutions:
- Verify node is accessible: `which node`
- If using nvm, ensure the node version is available globally
- Use the full path to node in `mcp.json`: `"command": "/usr/bin/node"`

## Uninstallation

1. Remove the power entry from your MCP configuration
2. (Optional) Delete the Knowledge Graph database:
   ```bash
   rm .git/archeology.db
   ```
3. Remove the power directory if it was cloned locally

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ARCHEOLOGY_WORKSPACE_ROOT` | Workspace root directory (override) | `process.cwd()` |

## Security Notes

- The Knowledge Graph is stored in `.git/archeology.db` (inside the Git directory, not committed)
- No data is transmitted to external servers by default
- External LLM configuration requires explicit user confirmation

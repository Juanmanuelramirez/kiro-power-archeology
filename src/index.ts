#!/usr/bin/env node

/**
 * Archeology Power - MCP Server Entry Point
 *
 * Main executable that starts the Archeology MCP server.
 * Handles repository detection, Knowledge Graph initialization,
 * and graceful shutdown.
 *
 * @module index
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';
import { GitCliAdapter } from './core/git-adapter.js';
import { KnowledgeGraphBuilder } from './core/graph-builder.js';
import { SqliteStore } from './storage/sqlite-store.js';

/**
 * Finds the .git directory closest to the workspace root.
 * Walks up from the workspace root to find the nearest .git directory.
 * Ignores nested repositories (only checks the given root and its parents).
 *
 * @param workspaceRoot - The workspace root directory
 * @returns The path to the repository root containing .git, or null if not found
 */
export function findGitRepo(workspaceRoot: string): string | null {
  let current = resolve(workspaceRoot);

  while (true) {
    const gitDir = join(current, '.git');
    if (existsSync(gitDir)) {
      // Verify it's a directory (or a file for worktrees/submodules)
      try {
        const stat = statSync(gitDir);
        if (stat.isDirectory() || stat.isFile()) {
          return current;
        }
      } catch {
        // stat failed, skip this candidate
      }
    }

    const parent = resolve(current, '..');
    if (parent === current) {
      // Reached filesystem root without finding .git
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * Main entry point for the Archeology MCP server.
 */
async function main(): Promise<void> {
  // Determine workspace root from environment or cwd
  const workspaceRoot = process.env.ARCHEOLOGY_WORKSPACE_ROOT ?? process.cwd();

  // Detect git repository (Req 7.2: find .git closest to workspace root)
  const repoRoot = findGitRepo(workspaceRoot);

  if (!repoRoot) {
    // Req 7.4: No git repo found — inform user and start with limited functionality
    console.error(
      '[archeology-power] No git repository found in workspace. ' +
      'Analysis features are disabled. Please open a workspace with a git repository.',
    );

    // Start server without analysis capabilities (limited mode)
    // Create minimal dependencies with in-memory store and a dummy adapter
    const store = new SqliteStore(':memory:');
    const gitAdapter = new GitCliAdapter(workspaceRoot);
    const graphBuilder = new KnowledgeGraphBuilder(gitAdapter, store);

    const server = createServer({ gitAdapter, store, graphBuilder });
    const transport = new StdioServerTransport();
    await server.connect(transport);

    setupShutdownHandlers(async () => {
      await server.close();
      store.close();
    });

    return;
  }

  // Req 7.6: Use root-level repo, ignore nested repositories
  const gitAdapter = new GitCliAdapter(repoRoot);

  // Validate the repository is functional
  const isValid = await gitAdapter.isValidRepo();
  if (!isValid) {
    console.error(
      '[archeology-power] Git repository detected but appears corrupted. ' +
      'Analysis features are disabled.',
    );

    const store = new SqliteStore(':memory:');
    const graphBuilder = new KnowledgeGraphBuilder(gitAdapter, store);

    const server = createServer({ gitAdapter, store, graphBuilder });
    const transport = new StdioServerTransport();
    await server.connect(transport);

    setupShutdownHandlers(async () => {
      await server.close();
      store.close();
    });

    return;
  }

  // Create SQLite store in .git/archeology.db
  const gitDir = await gitAdapter.getGitDir();
  const dbPath = join(repoRoot, gitDir, 'archeology.db');
  const store = new SqliteStore(dbPath);

  // Create Knowledge Graph builder
  const graphBuilder = new KnowledgeGraphBuilder(gitAdapter, store);
  await graphBuilder.initialize(repoRoot);

  // Req 7.5: Create and start the MCP server immediately
  // Graph-independent tools work while graph is building
  const server = createServer({ gitAdapter, store, graphBuilder });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Req 7.3: Trigger Knowledge Graph background build (don't await)
  // The server is already functional — graph-dependent tools will report
  // "not ready" status until the build completes
  if (!graphBuilder.isReady()) {
    graphBuilder.buildInitial().catch((err) => {
      console.error('[archeology-power] Knowledge Graph build failed:', err);
    });
  }

  // Setup graceful shutdown
  setupShutdownHandlers(async () => {
    await server.close();
    store.close();
  });
}

/**
 * Registers process signal handlers for graceful shutdown.
 */
function setupShutdownHandlers(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await cleanup();
    } catch (err) {
      console.error('[archeology-power] Error during shutdown:', err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run the main function
main().catch((err) => {
  console.error('[archeology-power] Fatal error:', err);
  process.exit(1);
});

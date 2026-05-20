/**
 * MCP Server setup and tool router for Archeology Power.
 *
 * Creates and configures the MCP server with all 9 tools registered,
 * routing incoming tool calls to the appropriate handler implementations.
 *
 * @module server
 * @requirements 6.1, 7.1, 7.3, 7.5
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { GitAdapter, GraphBuilder, ArcheologyConfig } from './types/index.js';
import type { SqliteStore } from './storage/sqlite-store.js';
import { GitIntentAnalyzer } from './tools/git-intent.js';
import { ShadowDebtDetector } from './tools/shadow-debt.js';
import { OracleChatEngine } from './tools/oracle-chat.js';
import { ExcavationCardGenerator } from './tools/excavation-card.js';
import { PreRefactorSafetyChecker } from './tools/pre-refactor-check.js';
import { MigrationScout } from './tools/migration-scout.js';
import { LogicalCouplingAnalyzer } from './tools/logical-coupling.js';
import { validateConfig, DEFAULT_CONFIG } from './config/defaults.js';

/**
 * Dependencies required to create the MCP server.
 */
export interface ServerDependencies {
  gitAdapter: GitAdapter;
  store: SqliteStore;
  graphBuilder: GraphBuilder;
}

/**
 * Creates and configures the Archeology MCP server with all tools registered.
 *
 * @param deps - The dependencies (GitAdapter, SqliteStore, GraphBuilder)
 * @returns A configured McpServer instance ready to be connected to a transport
 */
export function createServer(deps: ServerDependencies): McpServer {
  const { gitAdapter, store, graphBuilder } = deps;

  // Current configuration state (mutable, updated via configure tool)
  let currentConfig: ArcheologyConfig = { ...DEFAULT_CONFIG };

  // Create the MCP server instance
  const server = new McpServer(
    {
      name: 'archeology-power',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Instantiate tool handlers
  const intentAnalyzer = new GitIntentAnalyzer(gitAdapter);
  const shadowDebtDetector = new ShadowDebtDetector(gitAdapter);
  const oracleChat = new OracleChatEngine(store);
  const excavationCardGenerator = new ExcavationCardGenerator(gitAdapter);
  const preRefactorChecker = new PreRefactorSafetyChecker(gitAdapter);
  const migrationScout = new MigrationScout(store, gitAdapter);
  const logicalCouplingAnalyzer = new LogicalCouplingAnalyzer(store);

  // Wire the graph status provider into the oracle chat engine
  oracleChat.setGraphStatusProvider(() => graphBuilder.getStatus());

  // === Tool Registration ===

  // 1. analyze_intent
  server.tool(
    'analyze_intent',
    'Analyze the historical intent behind a range of lines in a file using git blame. Returns commits grouped by unique SHA, ordered most recent first (max 10), with natural language summaries.',
    {
      file: z.string().describe('Path to the file to analyze'),
      startLine: z.number().int().min(1).describe('Starting line number (1-based)'),
      endLine: z.number().int().min(1).describe('Ending line number (1-based, inclusive)'),
    },
    async ({ file, startLine, endLine }) => {
      const result = await intentAnalyzer.analyze({ file, startLine, endLine });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 2. detect_shadow_debt
  server.tool(
    'detect_shadow_debt',
    'Detect shadow technical debt by identifying files with high contributor churn and stale documentation. Classifies files as Archaeological Risk Zones.',
    {
      path: z.string().optional().describe('Directory path to analyze (defaults to repository root)'),
      contributorThreshold: z.number().int().min(1).optional().describe('Minimum unique contributors to flag (default: 20, min: 1)'),
      docStalenessMonths: z.number().int().min(1).optional().describe('Months since last doc update to consider stale (default: 6, min: 1)'),
      analysisPeriodMonths: z.number().int().min(3).optional().describe('Analysis period in months (default: 12, min: 3)'),
    },
    async ({ path, contributorThreshold, docStalenessMonths, analysisPeriodMonths }) => {
      const result = await shadowDebtDetector.detect({
        path,
        contributorThreshold,
        docStalenessMonths,
        analysisPeriodMonths,
      });

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result.report, null, 2) }],
      };
    },
  );

  // 3. ask_oracle
  server.tool(
    'ask_oracle',
    'Ask questions in natural language about the historical evolution of the repository. Queries the Knowledge Graph and returns factual answers backed by references.',
    {
      question: z.string().max(500).describe('Question about the repository history (max 500 characters)'),
    },
    async ({ question }) => {
      const result = await oracleChat.ask({ question });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4. get_excavation_card
  server.tool(
    'get_excavation_card',
    'Generate an Excavation Card with historical context for a file. Only generates cards for files older than 2 years with at least 2 commits.',
    {
      file: z.string().describe('Path to the file to generate a card for'),
    },
    async ({ file }) => {
      const card = await excavationCardGenerator.generate({ file });

      if (card === null) {
        return {
          content: [{ type: 'text', text: 'No Excavation Card available: file does not meet criteria (must be > 2 years old with at least 2 commits).' }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
      };
    },
  );

  // 5. check_refactor_safety
  server.tool(
    'check_refactor_safety',
    'Check if deleting a range of lines is safe by analyzing their git history for associations with bug fixes or edge cases. Generates warnings when potentially dangerous deletions are detected.',
    {
      file: z.string().describe('Path to the file being refactored'),
      startLine: z.number().int().min(1).describe('Starting line number of the deletion (1-based)'),
      endLine: z.number().int().min(1).describe('Ending line number of the deletion (1-based, inclusive)'),
    },
    async ({ file, startLine, endLine }) => {
      const result = await preRefactorChecker.check({ file, startLine, endLine });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 6. run_migration_scout
  server.tool(
    'run_migration_scout',
    'Generate a migration readiness report for a module/directory. Classifies files as safe, requires-investigation, or do-not-migrate based on dependencies, patches, and activity.',
    {
      path: z.string().describe('Directory path of the module to analyze'),
    },
    async ({ path }) => {
      const report = await migrationScout.analyze({ path });
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
      };
    },
  );

  // 7. get_logical_coupling
  server.tool(
    'get_logical_coupling',
    'Analyze logical coupling for a file by identifying other files frequently modified together in commits. Returns coupled files above the co-occurrence threshold, ordered by frequency.',
    {
      file: z.string().describe('Path to the file to analyze couplings for'),
      coOccurrenceThreshold: z.number().min(0.50).max(1.0).optional().describe('Minimum co-occurrence ratio to include (default: 0.70, min: 0.50)'),
      analysisPeriodMonths: z.number().int().min(3).optional().describe('Analysis period in months (default: 12, min: 3)'),
    },
    async ({ file, coOccurrenceThreshold, analysisPeriodMonths }) => {
      try {
        const result = logicalCouplingAnalyzer.analyze({
          file,
          coOccurrenceThreshold,
          analysisPeriodMonths,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // 8. get_graph_status
  server.tool(
    'get_graph_status',
    'Get the current state of the Knowledge Graph (building, ready, error, or not-initialized). Includes progress information and node counts.',
    {},
    async () => {
      const status = await graphBuilder.getStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      };
    },
  );

  // 9. configure
  server.tool(
    'configure',
    'Update Archeology Power configuration settings. Validates values against minimum constraints before applying.',
    {
      settings: z.object({
        contributorThreshold: z.number().int().optional().describe('Minimum unique contributors threshold (min: 1)'),
        docStalenessMonths: z.number().int().optional().describe('Documentation staleness period in months (min: 1)'),
        analysisPeriodMonths: z.number().int().optional().describe('Analysis period in months (min: 3)'),
        coOccurrenceThreshold: z.number().optional().describe('Co-occurrence threshold ratio (min: 0.50)'),
        couplingAnalysisPeriodMonths: z.number().int().optional().describe('Coupling analysis period in months (min: 3)'),
        fileAgeThresholdYears: z.number().optional().describe('File age threshold in years for Excavation Cards'),
        deletionLineThreshold: z.number().int().optional().describe('Minimum consecutive deleted lines to trigger safety check'),
        externalLlm: z.object({
          enabled: z.boolean(),
          endpoint: z.string(),
          apiKey: z.string(),
        }).optional().describe('External LLM configuration for Oracle Chat'),
      }).describe('Partial configuration settings to update'),
    },
    async ({ settings }) => {
      // Validate the provided settings
      const validationResult = validateConfig(settings);

      if (!validationResult.valid) {
        const errorMessages = validationResult.errors
          .map((e) => e.message)
          .join('; ');
        return {
          content: [{ type: 'text', text: `Configuration rejected: ${errorMessages}` }],
          isError: true,
        };
      }

      // Apply valid settings to current configuration
      currentConfig = { ...currentConfig, ...settings };

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, config: currentConfig }, null, 2) }],
      };
    },
  );

  return server;
}

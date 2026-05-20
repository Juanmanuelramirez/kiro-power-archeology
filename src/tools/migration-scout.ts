/**
 * Migration Scout Tool
 *
 * Generates migration readiness reports for a directory/module by classifying
 * files into "safe", "investigate", or "do-not-migrate" categories based on
 * git history analysis, logical coupling detection, and dead code heuristics.
 *
 * @module migration-scout
 * @requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import type { SqliteStore, CommitRecord } from '../storage/sqlite-store.js';
import type { GitAdapter, MigrationReport, MigrationFileEntry, RiskFileEntry } from '../types/index.js';
import { LogicalCouplingAnalyzer } from './logical-coupling.js';
import { calculateChurnScore } from '../core/churn-calculator.js';

/**
 * Input parameters for the run_migration_scout tool.
 */
export interface MigrationScoutInput {
  path: string;
}

/**
 * Keywords in commit messages that indicate security/fix patches.
 */
const SECURITY_FIX_KEYWORDS = [
  'fix',
  'bug',
  'patch',
  'security',
  'vulnerability',
  'cve',
  'edge case',
  'hotfix',
  'critical',
];

/**
 * Threshold in months for dead code detection (no modifications).
 */
const DEAD_CODE_MONTHS = 24;

/**
 * Minimum history in months for high confidence classification.
 */
const MIN_HISTORY_MONTHS = 6;

/**
 * Default co-occurrence threshold for logical coupling detection.
 */
const CO_OCCURRENCE_THRESHOLD = 0.70;

/**
 * Maximum number of top risk files in the executive summary.
 */
const TOP_RISK_FILES_COUNT = 5;

/**
 * Timeout for the entire analysis in milliseconds (60 seconds).
 */
const ANALYSIS_TIMEOUT_MS = 60_000;

/**
 * Migration Scout that generates migration readiness reports by analyzing
 * git history, logical couplings, and dead code indicators.
 */
export class MigrationScout {
  private readonly store: SqliteStore;
  private readonly gitAdapter: GitAdapter;

  constructor(store: SqliteStore, gitAdapter: GitAdapter) {
    this.store = store;
    this.gitAdapter = gitAdapter;
  }

  /**
   * Analyzes a module/directory and generates a migration readiness report.
   *
   * @param input - The directory path to analyze
   * @returns MigrationReport with file classifications and executive summary
   */
  async analyze(input: MigrationScoutInput): Promise<MigrationReport> {
    const startTime = Date.now();
    const { path: modulePath } = input;

    // Get all files in the module from the store
    const allFiles = this.store.getAllFiles();
    const moduleFiles = allFiles.filter((f) => f.current_path.startsWith(modulePath));

    // Determine history confidence
    const historyConfidence = this.determineHistoryConfidence();

    // Classify each file
    const safeToMigrate: MigrationFileEntry[] = [];
    const requiresInvestigation: MigrationFileEntry[] = [];
    const doNotMigrate: MigrationFileEntry[] = [];

    const couplingAnalyzer = new LogicalCouplingAnalyzer(this.store);

    for (const file of moduleFiles) {
      // Check timeout
      if (Date.now() - startTime > ANALYSIS_TIMEOUT_MS) {
        break;
      }

      const commits = this.store.getCommitsByFile(file.id);
      const entry = this.classifyFile(file.current_path, commits, couplingAnalyzer);

      switch (entry.category) {
        case 'safe':
          safeToMigrate.push(entry);
          break;
        case 'investigate':
          requiresInvestigation.push(entry);
          break;
        case 'do-not-migrate':
          doNotMigrate.push(entry);
          break;
      }
    }

    // Generate executive summary
    const totalFiles = safeToMigrate.length + requiresInvestigation.length + doNotMigrate.length;
    const topRiskFiles = this.getTopRiskFiles(requiresInvestigation, doNotMigrate);

    const report: MigrationReport = {
      modulePath,
      totalFiles,
      categories: {
        safeToMigrate,
        requiresInvestigation,
        doNotMigrate,
      },
      executiveSummary: {
        totalAnalyzed: totalFiles,
        distribution: {
          safe: safeToMigrate.length,
          investigate: requiresInvestigation.length,
          doNotMigrate: doNotMigrate.length,
        },
        topRiskFiles,
      },
      historyConfidence,
    };

    return report;
  }

  /**
   * Classifies a single file based on its commit history and logical couplings.
   */
  private classifyFile(
    filePath: string,
    commits: CommitRecord[],
    couplingAnalyzer: LogicalCouplingAnalyzer
  ): MigrationFileEntry {
    // Check for dead code: no modifications in 24 months
    if (this.isDeadCode(commits)) {
      return {
        path: filePath,
        category: 'do-not-migrate',
        reason: 'Dead code: no modifications in the last 24 months',
      };
    }

    // Check for logical couplings (> 70% co-occurrence)
    const logicalDependencies = this.getLogicalDependencies(filePath, couplingAnalyzer);

    // Check for security/fix patches in commit messages
    const securityPatches = this.getSecurityPatches(commits);

    // If file has logical dependencies or security patches → investigate
    if (logicalDependencies.length > 0 || securityPatches.length > 0) {
      const riskScore = this.calculateRiskScore(commits);
      return {
        path: filePath,
        category: 'investigate',
        reason: this.buildInvestigateReason(logicalDependencies, securityPatches),
        logicalDependencies: logicalDependencies.length > 0 ? logicalDependencies : undefined,
        securityPatches: securityPatches.length > 0 ? securityPatches : undefined,
        riskScore,
      };
    }

    // Otherwise → safe
    return {
      path: filePath,
      category: 'safe',
      reason: 'No hidden dependencies or critical patches detected',
    };
  }

  /**
   * Determines if a file is dead code based on the 24-month inactivity threshold.
   * A file is dead code if it has no modifications in the last 24 months.
   */
  private isDeadCode(commits: CommitRecord[]): boolean {
    if (commits.length === 0) {
      return true;
    }

    const now = new Date();
    const threshold = new Date(now);
    threshold.setMonth(threshold.getMonth() - DEAD_CODE_MONTHS);

    // Check if the most recent commit is older than 24 months
    const mostRecent = commits[0]; // commits are ordered by authored_date DESC
    const mostRecentDate = new Date(mostRecent.authored_date);

    return mostRecentDate < threshold;
  }

  /**
   * Gets logical dependencies for a file using the Logical Coupling Analyzer.
   * Returns paths of files with > 70% co-occurrence.
   */
  private getLogicalDependencies(
    filePath: string,
    couplingAnalyzer: LogicalCouplingAnalyzer
  ): string[] {
    try {
      const result = couplingAnalyzer.analyze({
        file: filePath,
        coOccurrenceThreshold: CO_OCCURRENCE_THRESHOLD,
      });
      return result.coupledFiles.map((f) => f.path);
    } catch {
      return [];
    }
  }

  /**
   * Detects security/fix patches by scanning commit messages for keywords.
   * Returns commit SHAs that contain security/fix-related keywords.
   */
  private getSecurityPatches(commits: CommitRecord[]): string[] {
    const patches: string[] = [];

    for (const commit of commits) {
      const messageLower = commit.message.toLowerCase();
      const hasSecurityKeyword = SECURITY_FIX_KEYWORDS.some((keyword) =>
        messageLower.includes(keyword)
      );

      if (hasSecurityKeyword) {
        patches.push(commit.sha);
      }
    }

    return patches;
  }

  /**
   * Calculates risk score for a file based on churn score + age factor.
   * Older files with more churn get higher risk scores.
   */
  private calculateRiskScore(commits: CommitRecord[]): number {
    if (commits.length === 0) return 0;

    // Get unique contributors
    const uniqueContributors = new Set(commits.map((c) => c.author_email)).size;

    // Calculate churn score
    const churnScore = calculateChurnScore(uniqueContributors, commits.length);

    // Calculate age factor: months since first commit / 12 (capped at 5)
    const oldestCommit = commits[commits.length - 1];
    const ageMonths = this.getMonthsDifference(new Date(oldestCommit.authored_date), new Date());
    const ageFactor = Math.min(ageMonths / 12, 5);

    return Math.round(churnScore + ageFactor * 10);
  }

  /**
   * Builds a human-readable reason for "investigate" classification.
   */
  private buildInvestigateReason(
    logicalDependencies: string[],
    securityPatches: string[]
  ): string {
    const reasons: string[] = [];

    if (logicalDependencies.length > 0) {
      reasons.push(`Has ${logicalDependencies.length} logical coupling(s) above 70% co-occurrence`);
    }

    if (securityPatches.length > 0) {
      reasons.push(`Has ${securityPatches.length} security/fix patch(es) in commit history`);
    }

    return reasons.join('; ');
  }

  /**
   * Gets the top N risk files from investigate and do-not-migrate categories.
   */
  private getTopRiskFiles(
    investigate: MigrationFileEntry[],
    doNotMigrate: MigrationFileEntry[]
  ): RiskFileEntry[] {
    const allWithRisk: RiskFileEntry[] = [];

    for (const entry of investigate) {
      if (entry.riskScore !== undefined) {
        allWithRisk.push({
          path: entry.path,
          riskScore: entry.riskScore,
          justification: entry.reason,
        });
      }
    }

    for (const entry of doNotMigrate) {
      allWithRisk.push({
        path: entry.path,
        riskScore: entry.riskScore ?? 0,
        justification: entry.reason,
      });
    }

    // Sort by risk score descending and take top 5
    allWithRisk.sort((a, b) => b.riskScore - a.riskScore);
    return allWithRisk.slice(0, TOP_RISK_FILES_COUNT);
  }

  /**
   * Determines history confidence based on the repository's commit history span.
   * Returns 'limited' if less than 6 months of history, 'high' otherwise.
   */
  private determineHistoryConfidence(): 'high' | 'limited' {
    const allCommits = this.store.getAllCommits();

    if (allCommits.length === 0) {
      return 'limited';
    }

    // Find oldest and newest commits
    let oldest = new Date(allCommits[0].authored_date);
    let newest = new Date(allCommits[0].authored_date);

    for (const commit of allCommits) {
      const date = new Date(commit.authored_date);
      if (date < oldest) oldest = date;
      if (date > newest) newest = date;
    }

    const historyMonths = this.getMonthsDifference(oldest, newest);
    return historyMonths < MIN_HISTORY_MONTHS ? 'limited' : 'high';
  }

  /**
   * Calculates the number of months between two dates.
   */
  private getMonthsDifference(start: Date, end: Date): number {
    return (
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth())
    );
  }
}

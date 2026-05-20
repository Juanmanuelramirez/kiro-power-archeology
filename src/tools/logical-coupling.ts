/**
 * Logical Coupling Analyzer Tool
 *
 * Analyzes the git commit history to identify files that are frequently
 * modified together (logical coupling). Calculates co-occurrence ratios
 * and returns coupled files above a configurable threshold.
 *
 * @module logical-coupling
 * @requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import type { SqliteStore, CommitRecord } from '../storage/sqlite-store.js';
import type { LogicalCouplingResult, CoupledFile } from '../types/index.js';

/**
 * Input parameters for the get_logical_coupling tool.
 */
export interface LogicalCouplingInput {
  file: string;
  coOccurrenceThreshold?: number;
  analysisPeriodMonths?: number;
}

/**
 * Minimum allowed co-occurrence threshold (50%).
 */
const MIN_CO_OCCURRENCE_THRESHOLD = 0.50;

/**
 * Minimum allowed analysis period in months.
 */
const MIN_ANALYSIS_PERIOD_MONTHS = 3;

/**
 * Default co-occurrence threshold (70%).
 */
const DEFAULT_CO_OCCURRENCE_THRESHOLD = 0.70;

/**
 * Default analysis period in months.
 */
const DEFAULT_ANALYSIS_PERIOD_MONTHS = 12;

/**
 * Maximum number of coupled file entries to return.
 */
const MAX_RESULTS = 20;

/**
 * Maximum number of recent shared commits to include per coupling.
 */
const MAX_RECENT_SHARED_COMMITS = 3;

/**
 * Logical Coupling Analyzer that identifies files frequently modified together
 * based on git commit history stored in the Knowledge Graph.
 */
export class LogicalCouplingAnalyzer {
  private readonly store: SqliteStore;

  constructor(store: SqliteStore) {
    this.store = store;
  }

  /**
   * Analyzes logical coupling for a given file.
   *
   * Calculates co-occurrence ratio for each other file that shares commits
   * with the target file within the analysis period. Filters pairs above
   * the threshold and returns results ordered by co-occurrence descending.
   *
   * @param input - The file path and optional configuration
   * @returns LogicalCouplingResult with coupled files or empty array if none found
   * @throws Error if threshold or period is below minimum allowed values
   */
  analyze(input: LogicalCouplingInput): LogicalCouplingResult {
    const {
      file,
      coOccurrenceThreshold = DEFAULT_CO_OCCURRENCE_THRESHOLD,
      analysisPeriodMonths = DEFAULT_ANALYSIS_PERIOD_MONTHS,
    } = input;

    // Validate threshold
    if (coOccurrenceThreshold < MIN_CO_OCCURRENCE_THRESHOLD) {
      throw new Error(
        `coOccurrenceThreshold must be at least ${MIN_CO_OCCURRENCE_THRESHOLD}, received ${coOccurrenceThreshold}`
      );
    }

    // Validate analysis period
    if (analysisPeriodMonths < MIN_ANALYSIS_PERIOD_MONTHS) {
      throw new Error(
        `analysisPeriodMonths must be at least ${MIN_ANALYSIS_PERIOD_MONTHS}, received ${analysisPeriodMonths}`
      );
    }

    // Calculate analysis period boundaries
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setMonth(periodStart.getMonth() - analysisPeriodMonths);

    const analysisPeriod = {
      start: periodStart.toISOString(),
      end: now.toISOString(),
    };

    // Look up the target file in the store
    const fileRecord = this.store.getFileByPath(file);
    if (!fileRecord) {
      return { file, coupledFiles: [], analysisperiod: analysisPeriod };
    }

    // Get all commits that modified the target file
    const allCommitsForFile = this.store.getCommitsByFile(fileRecord.id);

    // Filter commits within the analysis period
    const commitsInPeriod = allCommitsForFile.filter((commit) => {
      const commitDate = new Date(commit.authored_date);
      return commitDate >= periodStart && commitDate <= now;
    });

    if (commitsInPeriod.length === 0) {
      return { file, coupledFiles: [], analysisperiod: analysisPeriod };
    }

    // Build a set of commit IDs for the target file within the period
    const targetCommitIds = new Set(commitsInPeriod.map((c) => c.id));

    // For each commit, find other files that were also modified
    const otherFileCommits = new Map<number, CommitRecord[]>();

    for (const commit of commitsInPeriod) {
      const filesInCommit = this.store.getFilesByCommit(commit.id);
      for (const otherFile of filesInCommit) {
        if (otherFile.id === fileRecord.id) continue;

        if (!otherFileCommits.has(otherFile.id)) {
          otherFileCommits.set(otherFile.id, []);
        }
        otherFileCommits.get(otherFile.id)!.push(commit);
      }
    }

    // Calculate co-occurrence ratio for each other file
    const coupledFiles: CoupledFile[] = [];

    for (const [otherFileId, sharedCommits] of otherFileCommits) {
      // Get all commits for the other file within the analysis period
      const otherFileAllCommits = this.store.getCommitsByFile(otherFileId);
      const otherFileCommitsInPeriod = otherFileAllCommits.filter((commit) => {
        const commitDate = new Date(commit.authored_date);
        return commitDate >= periodStart && commitDate <= now;
      });

      // Total commits affecting either file = union of both sets
      const otherCommitIds = new Set(otherFileCommitsInPeriod.map((c) => c.id));
      const unionIds = new Set([...targetCommitIds, ...otherCommitIds]);

      const sharedCount = sharedCommits.length;
      const totalUnion = unionIds.size;

      if (totalUnion === 0) continue;

      const coOccurrenceRatio = sharedCount / totalUnion;

      // Filter by threshold
      if (coOccurrenceRatio < coOccurrenceThreshold) continue;

      // Get the other file's path
      const otherFileRecord = this.store.getFileById(otherFileId);
      if (!otherFileRecord) continue;

      // Get the 3 most recent shared commits (already sorted by date desc from store)
      const recentSharedCommits = sharedCommits
        .sort((a, b) => new Date(b.authored_date).getTime() - new Date(a.authored_date).getTime())
        .slice(0, MAX_RECENT_SHARED_COMMITS)
        .map((commit) => ({
          sha: commit.sha,
          date: commit.authored_date,
          message: commit.message,
        }));

      coupledFiles.push({
        path: otherFileRecord.current_path,
        coOccurrencePercentage: Math.round(coOccurrenceRatio * 100),
        sharedCommits: sharedCount,
        recentSharedCommits,
      });
    }

    // Sort by co-occurrence percentage descending and cap at 20
    coupledFiles.sort((a, b) => b.coOccurrencePercentage - a.coOccurrencePercentage);
    const cappedResults = coupledFiles.slice(0, MAX_RESULTS);

    return {
      file,
      coupledFiles: cappedResults,
      analysisperiod: analysisPeriod,
    };
  }
}

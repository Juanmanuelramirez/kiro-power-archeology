/**
 * Shadow Debt Detector Tool
 *
 * Identifies files with high churn (many contributors) and stale documentation,
 * classifying them as Archaeological Risk Zones. Uses git history to determine
 * contributor counts and documentation staleness.
 *
 * @module shadow-debt
 * @requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import { calculateChurnScore, validateHistoryPeriod } from '../core/churn-calculator.js';
import { validateConfig, DEFAULT_CONFIG } from '../config/defaults.js';
import type { GitAdapter, CommitEntry, ShadowDebtReport, ArchaeologicalRiskZone } from '../types/index.js';

/**
 * Input parameters for the detect_shadow_debt tool.
 */
export interface ShadowDebtInput {
  path?: string;
  contributorThreshold?: number;
  docStalenessMonths?: number;
  analysisPeriodMonths?: number;
}

/**
 * Result type that can be either a successful report or an error.
 */
export type ShadowDebtResult =
  | { success: true; report: ShadowDebtReport }
  | { success: false; error: string };

/**
 * Shadow Debt Detector that scans repository files to identify
 * Archaeological Risk Zones based on contributor count and documentation staleness.
 */
export class ShadowDebtDetector {
  private readonly gitAdapter: GitAdapter;

  constructor(gitAdapter: GitAdapter) {
    this.gitAdapter = gitAdapter;
  }

  /**
   * Detects shadow debt in the repository by analyzing file churn and documentation staleness.
   *
   * @param input - Configuration for the analysis
   * @returns A report with analyzed files and identified risk zones, or an error
   */
  async detect(input: ShadowDebtInput = {}): Promise<ShadowDebtResult> {
    const contributorThreshold = input.contributorThreshold ?? DEFAULT_CONFIG.contributorThreshold;
    const docStalenessMonths = input.docStalenessMonths ?? DEFAULT_CONFIG.docStalenessMonths;
    const analysisPeriodMonths = input.analysisPeriodMonths ?? DEFAULT_CONFIG.analysisPeriodMonths;

    // Validate configuration thresholds
    const validationResult = validateConfig({
      contributorThreshold,
      docStalenessMonths,
      analysisPeriodMonths,
    });

    if (!validationResult.valid) {
      const errorMessages = validationResult.errors
        .map((e) => e.message)
        .join('; ');
      return { success: false, error: errorMessages };
    }

    // Calculate analysis period dates
    const now = new Date();
    const analysisStart = new Date(now);
    analysisStart.setMonth(analysisStart.getMonth() - analysisPeriodMonths);

    // Check if repository has sufficient history
    const historyMonths = await this.getRepositoryHistoryMonths();
    const historyValidation = validateHistoryPeriod(historyMonths);

    if (!historyValidation.valid) {
      return { success: false, error: historyValidation.message! };
    }

    // Get list of files to analyze
    const targetPath = input.path ?? '.';
    const files = await this.getTrackedFiles(targetPath);

    // Analyze each file
    const riskZones: ArchaeologicalRiskZone[] = [];

    for (const filePath of files) {
      const fileAnalysis = await this.analyzeFile(
        filePath,
        analysisStart,
        now,
        contributorThreshold,
        docStalenessMonths,
        analysisPeriodMonths,
      );

      if (fileAnalysis) {
        riskZones.push(fileAnalysis);
      }
    }

    const report: ShadowDebtReport = {
      analyzedFiles: files.length,
      analysisPeriod: {
        start: analysisStart.toISOString(),
        end: now.toISOString(),
      },
      riskZones,
    };

    return { success: true, report };
  }

  /**
   * Analyzes a single file to determine if it qualifies as an Archaeological Risk Zone.
   *
   * A file is classified as a risk zone when:
   * 1. Number of unique contributors > contributorThreshold
   * 2. Documentation hasn't been updated in > docStalenessMonths
   */
  private async analyzeFile(
    filePath: string,
    analysisStart: Date,
    analysisEnd: Date,
    contributorThreshold: number,
    docStalenessMonths: number,
    analysisPeriodMonths: number,
  ): Promise<ArchaeologicalRiskZone | null> {
    try {
      // Get commits for this file within the analysis period
      const commits = await this.getFileCommits(filePath, analysisStart, analysisEnd);

      if (commits.length === 0) {
        return null;
      }

      // Count unique contributors
      const uniqueContributors = this.countUniqueContributors(commits);

      // Get last documentation update date
      const lastDocUpdate = await this.getLastDocumentationUpdate(filePath);

      // Calculate documentation staleness
      const docStalenessDate = new Date(analysisEnd);
      docStalenessDate.setMonth(docStalenessDate.getMonth() - docStalenessMonths);

      const isDocStale = lastDocUpdate === null || new Date(lastDocUpdate) < docStalenessDate;

      // Classification: Risk Zone if contributors > threshold AND docs are stale
      if (uniqueContributors > contributorThreshold && isDocStale) {
        const churnScore = calculateChurnScore(uniqueContributors, commits.length);

        return {
          filePath,
          uniqueContributors,
          lastDocumentationUpdate: lastDocUpdate,
          churnScore,
          analysisPeriodMonths,
        };
      }

      return null;
    } catch {
      // Skip files that can't be analyzed (e.g., deleted files, binary files)
      return null;
    }
  }

  /**
   * Gets commits for a specific file within the analysis period.
   */
  private async getFileCommits(
    filePath: string,
    since: Date,
    until: Date,
  ): Promise<CommitEntry[]> {
    const commits = await this.gitAdapter.log({
      since: since.toISOString(),
      until: until.toISOString(),
    });

    // Filter commits that affected this file by checking each commit's files
    const fileCommits: CommitEntry[] = [];
    for (const commit of commits) {
      try {
        const detail = await this.gitAdapter.show(commit.sha);
        if (detail.filesChanged.includes(filePath)) {
          fileCommits.push(commit);
        }
      } catch {
        // Skip commits that can't be inspected
      }
    }

    return fileCommits;
  }

  /**
   * Counts unique contributors from a list of commits based on email.
   */
  private countUniqueContributors(commits: CommitEntry[]): number {
    const uniqueEmails = new Set(commits.map((c) => c.authorEmail));
    return uniqueEmails.size;
  }

  /**
   * Determines when documentation (comments/docstrings) was last modified
   * by checking git log for changes to comment-containing lines.
   *
   * Returns the ISO date string of the last documentation update, or null
   * if no documentation changes are found.
   */
  private async getLastDocumentationUpdate(filePath: string): Promise<string | null> {
    try {
      // Use logFollow to get the full history of the file
      const commits = await this.gitAdapter.logFollow(filePath);

      if (commits.length === 0) {
        return null;
      }

      // Check commits from most recent to oldest for documentation changes
      for (const commit of commits) {
        try {
          const detail = await this.gitAdapter.show(commit.sha);
          // A commit that modified this file could have modified documentation
          // We use a heuristic: if the commit message mentions docs/comments
          // or if the commit has a small number of lines changed (likely doc updates)
          // For a more accurate approach, we'd need to diff comment lines specifically
          if (this.isLikelyDocumentationChange(detail.message, detail.linesAdded, detail.linesDeleted)) {
            return commit.date;
          }
        } catch {
          continue;
        }
      }

      // If no documentation-specific commits found, return null (docs are stale)
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Heuristic to determine if a commit likely modified documentation.
   * Checks for documentation-related keywords in commit messages.
   */
  private isLikelyDocumentationChange(message: string, _linesAdded: number, _linesDeleted: number): boolean {
    const docKeywords = [
      'doc', 'comment', 'jsdoc', 'javadoc', 'docstring',
      'readme', 'documentation', 'annotate', 'annotation',
      'describe', 'explain', 'clarify', 'typo',
    ];

    const lowerMessage = message.toLowerCase();
    return docKeywords.some((keyword) => lowerMessage.includes(keyword));
  }

  /**
   * Gets the number of months of git history available in the repository.
   */
  private async getRepositoryHistoryMonths(): Promise<number> {
    try {
      const allCommits = await this.gitAdapter.log({});

      if (allCommits.length === 0) {
        return 0;
      }

      // Find the oldest commit date
      const oldestCommit = allCommits[allCommits.length - 1];
      const oldestDate = new Date(oldestCommit.date);
      const now = new Date();

      const diffMs = now.getTime() - oldestDate.getTime();
      const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44); // Average days per month

      return Math.floor(diffMonths);
    } catch {
      return 0;
    }
  }

  /**
   * Gets the list of tracked files in the repository, optionally filtered by path.
   */
  private async getTrackedFiles(targetPath: string): Promise<string[]> {
    try {
      // Use git log to find files that have been committed
      const commits = await this.gitAdapter.log({ maxCount: 100 });
      const fileSet = new Set<string>();

      for (const commit of commits) {
        try {
          const detail = await this.gitAdapter.show(commit.sha);
          for (const file of detail.filesChanged) {
            if (targetPath === '.' || file.startsWith(targetPath)) {
              fileSet.add(file);
            }
          }
        } catch {
          // Skip commits that can't be inspected
        }
      }

      return Array.from(fileSet);
    } catch {
      return [];
    }
  }
}

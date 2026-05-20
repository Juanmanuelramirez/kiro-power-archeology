/**
 * Excavation Card Generator Tool
 *
 * Generates an informational card with historical context for files that are
 * older than 2 years and have at least 2 commits. The card includes the original
 * author, current maintainer, last major refactor, and cyclomatic complexity.
 *
 * @module excavation-card
 * @requirements 4.1, 4.2, 4.4, 4.5
 */

import type { GitAdapter, CommitEntry, ExcavationCard, FileNumStat } from '../types/index.js';

/**
 * Input parameters for the get_excavation_card tool.
 */
export interface ExcavationCardInput {
  file: string;
}

/**
 * Excavation Card Generator that produces historical context cards
 * for files meeting age and commit count criteria.
 */
export class ExcavationCardGenerator {
  private readonly gitAdapter: GitAdapter;

  constructor(gitAdapter: GitAdapter) {
    this.gitAdapter = gitAdapter;
  }

  /**
   * Generates an Excavation Card for the given file.
   *
   * Returns null if the file doesn't meet the criteria:
   * - First commit must be > 2 years old
   * - File must have at least 2 commits
   *
   * @param input - The file path to generate a card for
   * @returns ExcavationCard or null if criteria not met
   */
  async generate(input: ExcavationCardInput): Promise<ExcavationCard | null> {
    const { file } = input;

    // Get full file history using logFollow (handles renames)
    let commits: CommitEntry[];
    try {
      commits = await this.gitAdapter.logFollow(file);
    } catch {
      return null;
    }

    // Require at least 2 commits
    if (commits.length < 2) {
      return null;
    }

    // Determine file age from first commit (oldest = last in the array)
    const firstCommit = commits[commits.length - 1];
    const firstCommitDate = new Date(firstCommit.date);
    const now = new Date();

    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    // File must be older than 2 years
    if (firstCommitDate > twoYearsAgo) {
      return null;
    }

    // Build the card with graceful degradation
    const fieldsUnavailable: string[] = [];

    // Original author: author of the first (oldest) commit
    const originalAuthor = this.getOriginalAuthor(firstCommit, fieldsUnavailable);

    // Current maintainer: author with most commits in last 12 months
    const currentMaintainer = this.getCurrentMaintainer(commits, now, fieldsUnavailable);

    // Last major refactor: most recent commit modifying > 30% of lines
    const lastMajorRefactor = await this.getLastMajorRefactor(commits, file, fieldsUnavailable);

    // Cyclomatic complexity: placeholder (would need AST analysis)
    const cyclomaticComplexity = null;
    fieldsUnavailable.push('cyclomaticComplexity');

    // File age: human-readable string
    const fileAge = this.calculateFileAge(firstCommitDate, now);

    return {
      file,
      originalAuthor,
      currentMaintainer,
      lastMajorRefactor,
      cyclomaticComplexity,
      fileAge,
      fieldsUnavailable,
    };
  }

  /**
   * Gets the original author from the first commit.
   */
  private getOriginalAuthor(firstCommit: CommitEntry, fieldsUnavailable: string[]): string {
    if (firstCommit.authorName && firstCommit.authorName.trim() !== '') {
      return firstCommit.authorName;
    }
    fieldsUnavailable.push('originalAuthor');
    return 'not available';
  }

  /**
   * Determines the current maintainer as the author with the most commits
   * in the last 12 months.
   */
  private getCurrentMaintainer(
    commits: CommitEntry[],
    now: Date,
    fieldsUnavailable: string[],
  ): string {
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    // Filter commits from the last 12 months
    const recentCommits = commits.filter((c) => {
      const commitDate = new Date(c.date);
      return commitDate >= twelveMonthsAgo;
    });

    if (recentCommits.length === 0) {
      fieldsUnavailable.push('currentMaintainer');
      return 'not available';
    }

    // Count commits per author
    const authorCounts = new Map<string, number>();
    for (const commit of recentCommits) {
      const author = commit.authorName;
      authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
    }

    // Find author with most commits
    let topAuthor = '';
    let maxCount = 0;
    for (const [author, count] of authorCounts) {
      if (count > maxCount) {
        maxCount = count;
        topAuthor = author;
      }
    }

    if (topAuthor === '') {
      fieldsUnavailable.push('currentMaintainer');
      return 'not available';
    }

    return topAuthor;
  }

  /**
   * Finds the most recent commit that modified > 30% of the file's lines.
   * Uses numstat to determine the change ratio relative to estimated file size.
   *
   * The file size is estimated by summing net additions (added - deleted) across
   * all commits from oldest to newest.
   */
  private async getLastMajorRefactor(
    commits: CommitEntry[],
    file: string,
    fieldsUnavailable: string[],
  ): Promise<{ date: string; commitSha: string } | null> {
    // First, estimate the file size by processing commits from oldest to newest
    const estimatedSize = await this.estimateFileSizeFromHistory(commits, file);

    if (estimatedSize <= 0) {
      fieldsUnavailable.push('lastMajorRefactor');
      return null;
    }

    // Iterate from most recent to oldest to find the last major refactor
    for (const commit of commits) {
      try {
        const numstatEntries: FileNumStat[] = await this.gitAdapter.numstat(commit.sha);

        // Find the entry for our file
        const fileEntry = numstatEntries.find((entry) => entry.file === file);
        if (!fileEntry) {
          continue;
        }

        const totalChanged = fileEntry.added + fileEntry.deleted;

        // A major refactor is when total lines changed > 30% of estimated file size
        if (totalChanged > estimatedSize * 0.3) {
          return { date: commit.date, commitSha: commit.sha };
        }
      } catch {
        // Skip commits where numstat fails (e.g., initial commit without parent)
        continue;
      }
    }

    fieldsUnavailable.push('lastMajorRefactor');
    return null;
  }

  /**
   * Estimates the current file size by summing net additions across all commits
   * from oldest to newest.
   */
  private async estimateFileSizeFromHistory(commits: CommitEntry[], file: string): Promise<number> {
    let estimatedLines = 0;

    // Process from oldest to newest (reverse order since commits are newest-first)
    const orderedCommits = [...commits].reverse();

    for (const commit of orderedCommits) {
      try {
        const numstatEntries: FileNumStat[] = await this.gitAdapter.numstat(commit.sha);
        const fileEntry = numstatEntries.find((entry) => entry.file === file);
        if (fileEntry) {
          estimatedLines += fileEntry.added - fileEntry.deleted;
        }
      } catch {
        // Skip commits where numstat fails
        continue;
      }
    }

    return Math.max(estimatedLines, 0);
  }

  /**
   * Calculates a human-readable file age string.
   */
  private calculateFileAge(firstCommitDate: Date, now: Date): string {
    const diffMs = now.getTime() - firstCommitDate.getTime();
    const totalMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    if (years === 0) {
      return `${months} month${months !== 1 ? 's' : ''}`;
    }
    if (months === 0) {
      return `${years} year${years !== 1 ? 's' : ''}`;
    }
    return `${years} year${years !== 1 ? 's' : ''}, ${months} month${months !== 1 ? 's' : ''}`;
  }
}

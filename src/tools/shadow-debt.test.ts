import { describe, it, expect, beforeEach } from 'vitest';
import { ShadowDebtDetector } from './shadow-debt.js';
import type { GitAdapter, CommitEntry, CommitDetail, BlameEntry, GitLogOptions, FileDiffStat, FileNumStat } from '../types/index.js';

/**
 * Creates a mock GitAdapter for testing the Shadow Debt Detector.
 */
function createMockGitAdapter(options: {
  commits?: CommitEntry[];
  commitDetails?: Map<string, CommitDetail>;
  followCommits?: Map<string, CommitEntry[]>;
  repoHistoryMonths?: number;
  isValid?: boolean;
} = {}): GitAdapter {
  const {
    commits = [],
    commitDetails = new Map(),
    followCommits = new Map(),
    isValid = true,
  } = options;

  return {
    async blame(_file: string, _startLine: number, _endLine: number): Promise<BlameEntry[]> {
      return [];
    },
    async log(logOptions: GitLogOptions): Promise<CommitEntry[]> {
      if (logOptions.maxCount) {
        return commits.slice(0, logOptions.maxCount);
      }
      if (logOptions.since || logOptions.until) {
        return commits.filter((c) => {
          const date = new Date(c.date);
          if (logOptions.since && date < new Date(logOptions.since)) return false;
          if (logOptions.until && date > new Date(logOptions.until)) return false;
          return true;
        });
      }
      return commits;
    },
    async logFollow(file: string): Promise<CommitEntry[]> {
      return followCommits.get(file) ?? commits;
    },
    async show(commitSha: string): Promise<CommitDetail> {
      const detail = commitDetails.get(commitSha);
      if (!detail) {
        throw new Error(`Commit ${commitSha} not found`);
      }
      return detail;
    },
    async getRepoRoot(): Promise<string> {
      return '/mock/repo';
    },
    async getGitDir(): Promise<string> {
      return '/mock/repo/.git';
    },
    async isValidRepo(): Promise<boolean> {
      return isValid;
    },
    async diffStat(_commitSha: string): Promise<FileDiffStat[]> {
      return [];
    },
    async numstat(_commitSha: string): Promise<FileNumStat[]> {
      return [];
    },
    async getNewCommits(_sinceCommit: string | null): Promise<CommitEntry[]> {
      return [];
    },
  };
}

/**
 * Helper to create a commit entry with defaults.
 */
function makeCommit(overrides: Partial<CommitEntry> & { sha: string }): CommitEntry {
  return {
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
    date: new Date().toISOString(),
    message: 'test commit',
    ...overrides,
  };
}

/**
 * Helper to create a commit detail with defaults.
 */
function makeCommitDetail(overrides: Partial<CommitDetail> & { sha: string }): CommitDetail {
  return {
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
    date: new Date().toISOString(),
    message: 'test commit',
    linesAdded: 10,
    linesDeleted: 5,
    filesChanged: [],
    ...overrides,
  };
}

describe('ShadowDebtDetector', () => {
  describe('configuration validation', () => {
    it('rejects contributorThreshold below minimum (1)', async () => {
      const adapter = createMockGitAdapter();
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({ contributorThreshold: 0 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('contributorThreshold');
        expect(result.error).toContain('1');
      }
    });

    it('rejects docStalenessMonths below minimum (1)', async () => {
      const adapter = createMockGitAdapter();
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({ docStalenessMonths: 0 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('docStalenessMonths');
        expect(result.error).toContain('1');
      }
    });

    it('rejects analysisPeriodMonths below minimum (3)', async () => {
      const adapter = createMockGitAdapter();
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({ analysisPeriodMonths: 2 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('analysisPeriodMonths');
        expect(result.error).toContain('3');
      }
    });

    it('accepts valid threshold values at minimums', async () => {
      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const commits = [
        makeCommit({ sha: 'abc123', date: sixMonthsAgo.toISOString() }),
      ];
      const commitDetails = new Map([
        ['abc123', makeCommitDetail({ sha: 'abc123', date: sixMonthsAgo.toISOString(), filesChanged: [] })],
      ]);

      const adapter = createMockGitAdapter({ commits, commitDetails });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        contributorThreshold: 1,
        docStalenessMonths: 1,
        analysisPeriodMonths: 3,
      });

      expect(result.success).toBe(true);
    });

    it('reports multiple validation errors at once', async () => {
      const adapter = createMockGitAdapter();
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        contributorThreshold: 0,
        docStalenessMonths: 0,
        analysisPeriodMonths: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('contributorThreshold');
        expect(result.error).toContain('docStalenessMonths');
        expect(result.error).toContain('analysisPeriodMonths');
      }
    });
  });

  describe('insufficient history handling', () => {
    it('returns error when repository has less than 3 months of history', async () => {
      const now = new Date();
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const commits = [
        makeCommit({ sha: 'recent1', date: now.toISOString() }),
        makeCommit({ sha: 'recent2', date: oneMonthAgo.toISOString() }),
      ];
      const commitDetails = new Map([
        ['recent1', makeCommitDetail({ sha: 'recent1', date: now.toISOString(), filesChanged: [] })],
        ['recent2', makeCommitDetail({ sha: 'recent2', date: oneMonthAgo.toISOString(), filesChanged: [] })],
      ]);

      const adapter = createMockGitAdapter({ commits, commitDetails });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('3 meses');
      }
    });

    it('returns error when repository has no commits', async () => {
      const adapter = createMockGitAdapter({ commits: [] });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('risk zone classification', () => {
    let now: Date;
    let sixMonthsAgo: Date;
    let oneYearAgo: Date;

    beforeEach(() => {
      now = new Date();
      sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      oneYearAgo = new Date(now);
      oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
    });

    it('classifies file as risk zone when contributors > threshold AND docs are stale', async () => {
      // Create commits from many unique contributors (> 3 threshold for testing)
      const contributors = ['a@test.com', 'b@test.com', 'c@test.com', 'd@test.com', 'e@test.com'];
      const commits: CommitEntry[] = [];
      const commitDetails = new Map<string, CommitDetail>();

      contributors.forEach((email, i) => {
        const sha = `sha${i}`;
        const date = new Date(now);
        date.setMonth(date.getMonth() - (i + 1));

        commits.push(makeCommit({
          sha,
          authorEmail: email,
          authorName: `Author ${i}`,
          date: date.toISOString(),
          message: 'feature work',
        }));

        commitDetails.set(sha, makeCommitDetail({
          sha,
          authorEmail: email,
          authorName: `Author ${i}`,
          date: date.toISOString(),
          message: 'feature work',
          filesChanged: ['src/risky-file.ts'],
        }));
      });

      // Add an old commit for history depth
      const oldSha = 'old-sha';
      const oldDate = new Date(now);
      oldDate.setMonth(oldDate.getMonth() - 8);
      commits.push(makeCommit({ sha: oldSha, date: oldDate.toISOString() }));
      commitDetails.set(oldSha, makeCommitDetail({
        sha: oldSha,
        date: oldDate.toISOString(),
        filesChanged: [],
      }));

      // No documentation-related commits in logFollow
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/risky-file.ts', commits.filter((c) => c.sha !== oldSha).map((c) => ({
        ...c,
        message: 'feature work', // No doc keywords
      })));

      const adapter = createMockGitAdapter({ commits, commitDetails, followCommits });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        contributorThreshold: 3, // 5 contributors > 3
        docStalenessMonths: 1,
        analysisPeriodMonths: 6,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.report.riskZones.length).toBeGreaterThan(0);
        const zone = result.report.riskZones[0];
        expect(zone.filePath).toBe('src/risky-file.ts');
        expect(zone.uniqueContributors).toBe(5);
        expect(zone.churnScore).toBeGreaterThan(0);
        expect(zone.analysisPeriodMonths).toBe(6);
      }
    });

    it('does NOT classify file when contributors <= threshold', async () => {
      const commits: CommitEntry[] = [];
      const commitDetails = new Map<string, CommitDetail>();

      // Only 2 contributors (threshold is 3)
      const contributors = ['a@test.com', 'b@test.com'];
      contributors.forEach((email, i) => {
        const sha = `sha${i}`;
        const date = new Date(now);
        date.setMonth(date.getMonth() - (i + 1));

        commits.push(makeCommit({
          sha,
          authorEmail: email,
          date: date.toISOString(),
          message: 'work',
        }));

        commitDetails.set(sha, makeCommitDetail({
          sha,
          date: date.toISOString(),
          filesChanged: ['src/safe-file.ts'],
        }));
      });

      // Add old commit for history
      const oldSha = 'old-sha';
      const oldDate = new Date(now);
      oldDate.setMonth(oldDate.getMonth() - 8);
      commits.push(makeCommit({ sha: oldSha, date: oldDate.toISOString() }));
      commitDetails.set(oldSha, makeCommitDetail({ sha: oldSha, date: oldDate.toISOString(), filesChanged: [] }));

      const adapter = createMockGitAdapter({ commits, commitDetails });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        contributorThreshold: 3,
        docStalenessMonths: 1,
        analysisPeriodMonths: 6,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.report.riskZones.length).toBe(0);
      }
    });

    it('does NOT classify file when documentation is recent', async () => {
      const commits: CommitEntry[] = [];
      const commitDetails = new Map<string, CommitDetail>();

      // Many contributors
      const contributors = ['a@test.com', 'b@test.com', 'c@test.com', 'd@test.com', 'e@test.com'];
      contributors.forEach((email, i) => {
        const sha = `sha${i}`;
        const date = new Date(now);
        date.setMonth(date.getMonth() - (i + 1));

        commits.push(makeCommit({
          sha,
          authorEmail: email,
          date: date.toISOString(),
          message: i === 0 ? 'update documentation comments' : 'feature work',
        }));

        commitDetails.set(sha, makeCommitDetail({
          sha,
          date: date.toISOString(),
          message: i === 0 ? 'update documentation comments' : 'feature work',
          filesChanged: ['src/documented-file.ts'],
        }));
      });

      // Add old commit for history
      const oldSha = 'old-sha';
      const oldDate = new Date(now);
      oldDate.setMonth(oldDate.getMonth() - 8);
      commits.push(makeCommit({ sha: oldSha, date: oldDate.toISOString() }));
      commitDetails.set(oldSha, makeCommitDetail({ sha: oldSha, date: oldDate.toISOString(), filesChanged: [] }));

      // logFollow returns commits with a recent doc update
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/documented-file.ts', commits.filter((c) => c.sha !== oldSha));

      const adapter = createMockGitAdapter({ commits, commitDetails, followCommits });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        contributorThreshold: 3,
        docStalenessMonths: 6, // Doc was updated recently (within 6 months)
        analysisPeriodMonths: 6,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // The file should NOT be a risk zone because docs were recently updated
        expect(result.report.riskZones.length).toBe(0);
      }
    });
  });

  describe('report structure', () => {
    it('includes analyzedFiles count in the report', async () => {
      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const commits = [
        makeCommit({ sha: 'sha1', date: now.toISOString() }),
        makeCommit({ sha: 'sha2', date: sixMonthsAgo.toISOString() }),
      ];
      const commitDetails = new Map([
        ['sha1', makeCommitDetail({ sha: 'sha1', date: now.toISOString(), filesChanged: ['file1.ts'] })],
        ['sha2', makeCommitDetail({ sha: 'sha2', date: sixMonthsAgo.toISOString(), filesChanged: ['file2.ts'] })],
      ]);

      const adapter = createMockGitAdapter({ commits, commitDetails });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({ analysisPeriodMonths: 12 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.report.analyzedFiles).toBeGreaterThanOrEqual(0);
        expect(typeof result.report.analyzedFiles).toBe('number');
      }
    });

    it('includes analysisPeriod with start and end dates', async () => {
      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const commits = [
        makeCommit({ sha: 'sha1', date: now.toISOString() }),
        makeCommit({ sha: 'sha2', date: sixMonthsAgo.toISOString() }),
      ];
      const commitDetails = new Map([
        ['sha1', makeCommitDetail({ sha: 'sha1', date: now.toISOString(), filesChanged: [] })],
        ['sha2', makeCommitDetail({ sha: 'sha2', date: sixMonthsAgo.toISOString(), filesChanged: [] })],
      ]);

      const adapter = createMockGitAdapter({ commits, commitDetails });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({ analysisPeriodMonths: 12 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.report.analysisPeriod.start).toBeDefined();
        expect(result.report.analysisPeriod.end).toBeDefined();
        // Start should be before end
        expect(new Date(result.report.analysisPeriod.start).getTime())
          .toBeLessThan(new Date(result.report.analysisPeriod.end).getTime());
      }
    });

    it('risk zone includes all required fields', async () => {
      const now = new Date();
      const commits: CommitEntry[] = [];
      const commitDetails = new Map<string, CommitDetail>();

      // Create enough contributors to exceed threshold
      for (let i = 0; i < 6; i++) {
        const sha = `sha${i}`;
        const date = new Date(now);
        date.setMonth(date.getMonth() - (i + 1));

        commits.push(makeCommit({
          sha,
          authorEmail: `author${i}@test.com`,
          date: date.toISOString(),
          message: 'feature work',
        }));

        commitDetails.set(sha, makeCommitDetail({
          sha,
          date: date.toISOString(),
          message: 'feature work',
          filesChanged: ['src/target.ts'],
        }));
      }

      // Old commit for history
      const oldSha = 'old-sha';
      const oldDate = new Date(now);
      oldDate.setMonth(oldDate.getMonth() - 10);
      commits.push(makeCommit({ sha: oldSha, date: oldDate.toISOString() }));
      commitDetails.set(oldSha, makeCommitDetail({ sha: oldSha, date: oldDate.toISOString(), filesChanged: [] }));

      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/target.ts', commits.filter((c) => c.sha !== oldSha));

      const adapter = createMockGitAdapter({ commits, commitDetails, followCommits });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        contributorThreshold: 4,
        docStalenessMonths: 1,
        analysisPeriodMonths: 8,
      });

      expect(result.success).toBe(true);
      if (result.success && result.report.riskZones.length > 0) {
        const zone = result.report.riskZones[0];
        expect(zone.filePath).toBeDefined();
        expect(typeof zone.filePath).toBe('string');
        expect(zone.uniqueContributors).toBeDefined();
        expect(typeof zone.uniqueContributors).toBe('number');
        expect(zone.uniqueContributors).toBeGreaterThan(0);
        expect('lastDocumentationUpdate' in zone).toBe(true);
        expect(zone.churnScore).toBeDefined();
        expect(typeof zone.churnScore).toBe('number');
        expect(zone.churnScore).toBeGreaterThan(0);
        expect(zone.analysisPeriodMonths).toBeDefined();
        expect(typeof zone.analysisPeriodMonths).toBe('number');
      }
    });
  });

  describe('default configuration', () => {
    it('uses default values when no input is provided', async () => {
      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const commits = [
        makeCommit({ sha: 'sha1', date: now.toISOString() }),
        makeCommit({ sha: 'sha2', date: sixMonthsAgo.toISOString() }),
      ];
      const commitDetails = new Map([
        ['sha1', makeCommitDetail({ sha: 'sha1', date: now.toISOString(), filesChanged: [] })],
        ['sha2', makeCommitDetail({ sha: 'sha2', date: sixMonthsAgo.toISOString(), filesChanged: [] })],
      ]);

      const adapter = createMockGitAdapter({ commits, commitDetails });
      const detector = new ShadowDebtDetector(adapter);

      // Should not throw with empty input (uses defaults)
      const result = await detector.detect();

      expect(result.success).toBe(true);
    });
  });

  describe('path filtering', () => {
    it('filters files by path when provided', async () => {
      const now = new Date();
      const commits: CommitEntry[] = [];
      const commitDetails = new Map<string, CommitDetail>();

      // Create commits affecting files in different paths
      const sha1 = 'sha1';
      const sha2 = 'sha2';
      const date = new Date(now);
      date.setMonth(date.getMonth() - 2);

      commits.push(makeCommit({ sha: sha1, date: date.toISOString() }));
      commits.push(makeCommit({ sha: sha2, date: now.toISOString() }));

      commitDetails.set(sha1, makeCommitDetail({
        sha: sha1,
        date: date.toISOString(),
        filesChanged: ['src/tools/file1.ts', 'src/core/file2.ts'],
      }));
      commitDetails.set(sha2, makeCommitDetail({
        sha: sha2,
        date: now.toISOString(),
        filesChanged: ['src/tools/file3.ts'],
      }));

      // Add old commit for history
      const oldSha = 'old-sha';
      const oldDate = new Date(now);
      oldDate.setMonth(oldDate.getMonth() - 6);
      commits.push(makeCommit({ sha: oldSha, date: oldDate.toISOString() }));
      commitDetails.set(oldSha, makeCommitDetail({ sha: oldSha, date: oldDate.toISOString(), filesChanged: [] }));

      const adapter = createMockGitAdapter({ commits, commitDetails });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        path: 'src/tools',
        analysisPeriodMonths: 3,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Only files under src/tools should be analyzed
        expect(result.report.analyzedFiles).toBe(2); // file1.ts and file3.ts
      }
    });
  });

  describe('churn score calculation', () => {
    it('calculates churn score using contributor count and commit count', async () => {
      const now = new Date();
      const commits: CommitEntry[] = [];
      const commitDetails = new Map<string, CommitDetail>();

      // 5 unique contributors, 5 commits
      for (let i = 0; i < 5; i++) {
        const sha = `sha${i}`;
        const date = new Date(now);
        date.setMonth(date.getMonth() - (i + 1));

        commits.push(makeCommit({
          sha,
          authorEmail: `author${i}@test.com`,
          date: date.toISOString(),
          message: 'work',
        }));

        commitDetails.set(sha, makeCommitDetail({
          sha,
          date: date.toISOString(),
          filesChanged: ['src/churny.ts'],
        }));
      }

      // Old commit for history
      const oldSha = 'old-sha';
      const oldDate = new Date(now);
      oldDate.setMonth(oldDate.getMonth() - 10);
      commits.push(makeCommit({ sha: oldSha, date: oldDate.toISOString() }));
      commitDetails.set(oldSha, makeCommitDetail({ sha: oldSha, date: oldDate.toISOString(), filesChanged: [] }));

      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/churny.ts', commits.filter((c) => c.sha !== oldSha));

      const adapter = createMockGitAdapter({ commits, commitDetails, followCommits });
      const detector = new ShadowDebtDetector(adapter);

      const result = await detector.detect({
        contributorThreshold: 3,
        docStalenessMonths: 1,
        analysisPeriodMonths: 8,
      });

      expect(result.success).toBe(true);
      if (result.success && result.report.riskZones.length > 0) {
        const zone = result.report.riskZones[0];
        // Churn score = (5 contributors * 3) + (5 commits * 1) = 20
        expect(zone.churnScore).toBe(20);
      }
    });
  });
});

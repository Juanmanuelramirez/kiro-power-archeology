import { describe, it, expect } from 'vitest';
import { ExcavationCardGenerator } from './excavation-card.js';
import type { GitAdapter, CommitEntry, CommitDetail, BlameEntry, GitLogOptions, FileDiffStat, FileNumStat } from '../types/index.js';

/**
 * Creates a mock GitAdapter for testing the Excavation Card Generator.
 */
function createMockGitAdapter(options: {
  followCommits?: Map<string, CommitEntry[]>;
  numstatResults?: Map<string, FileNumStat[]>;
  showResults?: Map<string, CommitDetail>;
} = {}): GitAdapter {
  const {
    followCommits = new Map(),
    numstatResults = new Map(),
    showResults = new Map(),
  } = options;

  return {
    async blame(_file: string, _startLine: number, _endLine: number): Promise<BlameEntry[]> {
      return [];
    },
    async log(_options: GitLogOptions): Promise<CommitEntry[]> {
      return [];
    },
    async logFollow(file: string): Promise<CommitEntry[]> {
      const commits = followCommits.get(file);
      if (!commits) {
        throw new Error(`File ${file} not found`);
      }
      return commits;
    },
    async show(commitSha: string): Promise<CommitDetail> {
      const detail = showResults.get(commitSha);
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
      return true;
    },
    async diffStat(_commitSha: string): Promise<FileDiffStat[]> {
      return [];
    },
    async numstat(commitSha: string): Promise<FileNumStat[]> {
      return numstatResults.get(commitSha) ?? [];
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
 * Helper to create a date N years and M months ago.
 */
function dateAgo(years: number, months: number = 0): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(d.getMonth() - months);
  return d;
}

describe('ExcavationCardGenerator', () => {
  describe('eligibility criteria', () => {
    it('returns null when file has fewer than 2 commits', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/young.ts', [
        makeCommit({ sha: 'abc123', date: dateAgo(3).toISOString() }),
      ]);

      const adapter = createMockGitAdapter({ followCommits });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/young.ts' });

      expect(result).toBeNull();
    });

    it('returns null when file is younger than 2 years', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/recent.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 6).toISOString() }),
        makeCommit({ sha: 'sha2', date: dateAgo(1, 6).toISOString() }),
      ]);

      const adapter = createMockGitAdapter({ followCommits });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/recent.ts' });

      expect(result).toBeNull();
    });

    it('returns null when file has exactly 1 commit even if old', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/single.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(5).toISOString() }),
      ]);

      const adapter = createMockGitAdapter({ followCommits });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/single.ts' });

      expect(result).toBeNull();
    });

    it('returns null when logFollow throws (file not tracked)', async () => {
      const adapter = createMockGitAdapter({ followCommits: new Map() });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/untracked.ts' });

      expect(result).toBeNull();
    });

    it('generates card when file has >= 2 commits and is > 2 years old', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/old.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 3).toISOString(), authorName: 'Recent Dev' }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/old.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/old.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/old.ts' });

      expect(result).not.toBeNull();
      expect(result!.file).toBe('src/old.ts');
    });

    it('generates card when file is exactly at the 2-year boundary (first commit > 2 years)', async () => {
      // First commit is just over 2 years ago
      const justOverTwoYears = new Date();
      justOverTwoYears.setFullYear(justOverTwoYears.getFullYear() - 2);
      justOverTwoYears.setDate(justOverTwoYears.getDate() - 1);

      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/boundary.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 1).toISOString() }),
        makeCommit({ sha: 'sha2', date: justOverTwoYears.toISOString(), authorName: 'Boundary Dev' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/boundary.ts', added: 3, deleted: 1 }]);
      numstatResults.set('sha2', [{ file: 'src/boundary.ts', added: 50, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/boundary.ts' });

      expect(result).not.toBeNull();
    });
  });

  describe('originalAuthor field', () => {
    it('returns the author of the oldest commit', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 6).toISOString(), authorName: 'Recent Dev' }),
        makeCommit({ sha: 'sha2', date: dateAgo(1).toISOString(), authorName: 'Middle Dev' }),
        makeCommit({ sha: 'sha3', date: dateAgo(3).toISOString(), authorName: 'Original Creator' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 10, deleted: 3 }]);
      numstatResults.set('sha3', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.originalAuthor).toBe('Original Creator');
      expect(result!.fieldsUnavailable).not.toContain('originalAuthor');
    });

    it('marks originalAuthor as unavailable when author name is empty', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 6).toISOString(), authorName: 'Recent Dev' }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString(), authorName: '' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.originalAuthor).toBe('not available');
      expect(result!.fieldsUnavailable).toContain('originalAuthor');
    });
  });

  describe('currentMaintainer field', () => {
    it('returns the author with most commits in last 12 months', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 1).toISOString(), authorName: 'Frequent Dev' }),
        makeCommit({ sha: 'sha2', date: dateAgo(0, 2).toISOString(), authorName: 'Frequent Dev' }),
        makeCommit({ sha: 'sha3', date: dateAgo(0, 3).toISOString(), authorName: 'Frequent Dev' }),
        makeCommit({ sha: 'sha4', date: dateAgo(0, 4).toISOString(), authorName: 'Occasional Dev' }),
        makeCommit({ sha: 'sha5', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 3, deleted: 1 }]);
      numstatResults.set('sha3', [{ file: 'src/file.ts', added: 4, deleted: 2 }]);
      numstatResults.set('sha4', [{ file: 'src/file.ts', added: 2, deleted: 1 }]);
      numstatResults.set('sha5', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.currentMaintainer).toBe('Frequent Dev');
      expect(result!.fieldsUnavailable).not.toContain('currentMaintainer');
    });

    it('marks currentMaintainer as unavailable when no commits in last 12 months', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(1, 6).toISOString(), authorName: 'Old Dev' }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 10, deleted: 5 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.currentMaintainer).toBe('not available');
      expect(result!.fieldsUnavailable).toContain('currentMaintainer');
    });
  });

  describe('lastMajorRefactor field', () => {
    it('identifies commit modifying > 30% of file lines as major refactor', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 3).toISOString(), authorName: 'Dev A' }),
        makeCommit({ sha: 'sha2', date: dateAgo(1).toISOString(), authorName: 'Dev B' }),
        makeCommit({ sha: 'sha3', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      // File was created with 100 lines, then had a small change, then a big refactor
      const numstatResults = new Map<string, FileNumStat[]>();
      // sha3 (oldest): created file with 100 lines
      numstatResults.set('sha3', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);
      // sha2: major refactor - modified 50 lines (50% of 100)
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 40, deleted: 30 }]);
      // sha1: small change - 5 lines
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.lastMajorRefactor).not.toBeNull();
      // sha2 is the most recent commit with > 30% change
      expect(result!.lastMajorRefactor!.commitSha).toBe('sha2');
      expect(result!.fieldsUnavailable).not.toContain('lastMajorRefactor');
    });

    it('returns the most recent major refactor when multiple exist', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 2).toISOString(), authorName: 'Dev A' }),
        makeCommit({ sha: 'sha2', date: dateAgo(0, 6).toISOString(), authorName: 'Dev B' }),
        makeCommit({ sha: 'sha3', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      // File: 100 lines created, then two major refactors
      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha3', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 50, deleted: 40 }]);
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 60, deleted: 50 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.lastMajorRefactor).not.toBeNull();
      // sha1 is the most recent major refactor
      expect(result!.lastMajorRefactor!.commitSha).toBe('sha1');
    });

    it('marks lastMajorRefactor as unavailable when no commit exceeds 30% threshold', async () => {
      // Use many small commits so each one is < 30% of the total file size
      const followCommits = new Map<string, CommitEntry[]>();
      const commits: CommitEntry[] = [];
      for (let i = 0; i < 10; i++) {
        commits.push(makeCommit({
          sha: `sha${i}`,
          date: dateAgo(0, 3 + i * 3).toISOString(),
          authorName: `Dev ${i}`,
        }));
      }
      followCommits.set('src/file.ts', commits);

      // Each commit adds 20 lines and deletes 5 → net 15 per commit
      // Total estimated size: 10 * 15 = 150
      // Each commit changes 25 lines → 25/150 = 16.7% < 30% ✓
      const numstatResults = new Map<string, FileNumStat[]>();
      for (let i = 0; i < 10; i++) {
        numstatResults.set(`sha${i}`, [{ file: 'src/file.ts', added: 20, deleted: 5 }]);
      }

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.lastMajorRefactor).toBeNull();
      expect(result!.fieldsUnavailable).toContain('lastMajorRefactor');
    });

    it('handles numstat failures gracefully', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 3).toISOString(), authorName: 'Dev A' }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      // No numstat results - all calls will return empty
      const adapter = createMockGitAdapter({ followCommits });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.lastMajorRefactor).toBeNull();
      expect(result!.fieldsUnavailable).toContain('lastMajorRefactor');
    });
  });

  describe('cyclomaticComplexity field', () => {
    it('always returns null (placeholder for AST analysis)', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 3).toISOString() }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString() }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.cyclomaticComplexity).toBeNull();
      expect(result!.fieldsUnavailable).toContain('cyclomaticComplexity');
    });
  });

  describe('fileAge field', () => {
    it('formats age as years and months', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 3).toISOString() }),
        makeCommit({ sha: 'sha2', date: dateAgo(3, 2).toISOString() }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      // Should contain "years" since it's > 2 years old
      expect(result!.fileAge).toMatch(/\d+ years?/);
    });

    it('formats age with only years when months is 0', async () => {
      // Create a date exactly 3 years ago (approximately)
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
      // Adjust to be at the start of the current month to get 0 remaining months
      threeYearsAgo.setDate(1);
      const now = new Date();
      now.setDate(1);

      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 3).toISOString() }),
        makeCommit({ sha: 'sha2', date: threeYearsAgo.toISOString() }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.fileAge).toMatch(/\d+ years?/);
    });
  });

  describe('fieldsUnavailable', () => {
    it('always includes cyclomaticComplexity', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 3).toISOString(), authorName: 'Dev A' }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha1', [{ file: 'src/file.ts', added: 5, deleted: 2 }]);
      numstatResults.set('sha2', [{ file: 'src/file.ts', added: 100, deleted: 0 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.fieldsUnavailable).toContain('cyclomaticComplexity');
    });

    it('includes multiple unavailable fields when data is missing', async () => {
      // File with no recent commits (no maintainer) and no numstat data (no refactor)
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(1, 6).toISOString(), authorName: 'Old Dev' }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString(), authorName: 'Original Dev' }),
      ]);

      // No numstat data
      const adapter = createMockGitAdapter({ followCommits });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      expect(result).not.toBeNull();
      expect(result!.fieldsUnavailable).toContain('currentMaintainer');
      expect(result!.fieldsUnavailable).toContain('lastMajorRefactor');
      expect(result!.fieldsUnavailable).toContain('cyclomaticComplexity');
    });

    it('does not omit the card when fields are unavailable', async () => {
      // All optional fields unavailable but card should still be generated
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/file.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(1, 6).toISOString(), authorName: '' }),
        makeCommit({ sha: 'sha2', date: dateAgo(3).toISOString(), authorName: '' }),
      ]);

      const adapter = createMockGitAdapter({ followCommits });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/file.ts' });

      // Card should still be generated even with many unavailable fields
      expect(result).not.toBeNull();
      expect(result!.file).toBe('src/file.ts');
      expect(result!.fieldsUnavailable.length).toBeGreaterThan(0);
    });
  });

  describe('card structure completeness', () => {
    it('returns all required fields in the card', async () => {
      const followCommits = new Map<string, CommitEntry[]>();
      followCommits.set('src/complete.ts', [
        makeCommit({ sha: 'sha1', date: dateAgo(0, 2).toISOString(), authorName: 'Active Dev' }),
        makeCommit({ sha: 'sha2', date: dateAgo(0, 6).toISOString(), authorName: 'Active Dev' }),
        makeCommit({ sha: 'sha3', date: dateAgo(1).toISOString(), authorName: 'Refactor Dev' }),
        makeCommit({ sha: 'sha4', date: dateAgo(4).toISOString(), authorName: 'Original Dev' }),
      ]);

      const numstatResults = new Map<string, FileNumStat[]>();
      numstatResults.set('sha4', [{ file: 'src/complete.ts', added: 200, deleted: 0 }]);
      numstatResults.set('sha3', [{ file: 'src/complete.ts', added: 80, deleted: 70 }]);
      numstatResults.set('sha2', [{ file: 'src/complete.ts', added: 10, deleted: 5 }]);
      numstatResults.set('sha1', [{ file: 'src/complete.ts', added: 3, deleted: 1 }]);

      const adapter = createMockGitAdapter({ followCommits, numstatResults });
      const generator = new ExcavationCardGenerator(adapter);

      const result = await generator.generate({ file: 'src/complete.ts' });

      expect(result).not.toBeNull();
      expect(result!.file).toBe('src/complete.ts');
      expect(result!.originalAuthor).toBe('Original Dev');
      expect(result!.currentMaintainer).toBe('Active Dev');
      expect(result!.lastMajorRefactor).not.toBeNull();
      expect(result!.lastMajorRefactor!.commitSha).toBe('sha3');
      expect(result!.cyclomaticComplexity).toBeNull();
      expect(result!.fileAge).toMatch(/\d+ years?/);
      expect(Array.isArray(result!.fieldsUnavailable)).toBe(true);
    });
  });
});

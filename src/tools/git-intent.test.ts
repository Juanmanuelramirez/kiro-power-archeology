import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitIntentAnalyzer } from './git-intent.js';
import type { GitAdapter, BlameEntry, CommitDetail } from '../types/index.js';

function createMockGitAdapter(overrides: Partial<GitAdapter> = {}): GitAdapter {
  return {
    blame: vi.fn().mockResolvedValue([]),
    log: vi.fn().mockResolvedValue([]),
    logFollow: vi.fn().mockResolvedValue([]),
    show: vi.fn().mockResolvedValue({
      sha: '',
      authorName: '',
      authorEmail: '',
      date: '',
      message: '',
      linesAdded: 0,
      linesDeleted: 0,
      filesChanged: [],
    } satisfies CommitDetail),
    getRepoRoot: vi.fn().mockResolvedValue('/repo'),
    getGitDir: vi.fn().mockResolvedValue('.git'),
    isValidRepo: vi.fn().mockResolvedValue(true),
    diffStat: vi.fn().mockResolvedValue([]),
    numstat: vi.fn().mockResolvedValue([]),
    getNewCommits: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeBlameEntry(overrides: Partial<BlameEntry> = {}): BlameEntry {
  return {
    commitSha: 'abc1234567890123456789012345678901234567',
    author: 'John Doe',
    authorEmail: 'john@example.com',
    authorDate: '2024-06-15T10:00:00.000Z',
    line: 1,
    content: 'const x = 1;',
    ...overrides,
  };
}

describe('GitIntentAnalyzer', () => {
  let analyzer: GitIntentAnalyzer;
  let mockAdapter: GitAdapter;

  beforeEach(() => {
    mockAdapter = createMockGitAdapter();
    analyzer = new GitIntentAnalyzer(mockAdapter);
  });

  describe('input validation', () => {
    it('should reject line range exceeding 500 lines', async () => {
      const result = await analyzer.analyze({
        file: 'src/main.ts',
        startLine: 1,
        endLine: 501,
      });

      expect(result.commits).toHaveLength(0);
      expect(result.summary).toContain('Invalid line range');
      expect(result.summary).toContain('500');
    });

    it('should reject startLine less than 1', async () => {
      const result = await analyzer.analyze({
        file: 'src/main.ts',
        startLine: 0,
        endLine: 10,
      });

      expect(result.commits).toHaveLength(0);
      expect(result.summary).toContain('Invalid line range');
    });

    it('should reject endLine less than startLine', async () => {
      const result = await analyzer.analyze({
        file: 'src/main.ts',
        startLine: 10,
        endLine: 5,
      });

      expect(result.commits).toHaveLength(0);
      expect(result.summary).toContain('Invalid line range');
    });

    it('should accept exactly 500 lines', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Initial commit',
        linesAdded: 10,
        linesDeleted: 0,
        filesChanged: ['src/main.ts'],
      });

      const result = await analyzer.analyze({
        file: 'src/main.ts',
        startLine: 1,
        endLine: 500,
      });

      expect(result.commits.length).toBeGreaterThanOrEqual(1);
    });

    it('should accept a single line (startLine === endLine)', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 5 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Fix bug',
        linesAdded: 1,
        linesDeleted: 1,
        filesChanged: ['src/main.ts'],
      });

      const result = await analyzer.analyze({
        file: 'src/main.ts',
        startLine: 5,
        endLine: 5,
      });

      expect(result.commits).toHaveLength(1);
      expect(result.lineRange).toEqual({ start: 5, end: 5 });
    });
  });

  describe('blame error handling (Req 1.5)', () => {
    it('should handle blame failure gracefully', async () => {
      vi.mocked(mockAdapter.blame).mockRejectedValue(
        new Error('fatal: no such path \'missing.ts\' in HEAD')
      );

      const result = await analyzer.analyze({
        file: 'missing.ts',
        startLine: 1,
        endLine: 10,
      });

      expect(result.commits).toHaveLength(0);
      expect(result.summary).toContain('No history available');
      expect(result.file).toBe('missing.ts');
      expect(result.lineRange).toEqual({ start: 1, end: 10 });
    });

    it('should handle empty blame result', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([]);

      const result = await analyzer.analyze({
        file: 'empty.ts',
        startLine: 1,
        endLine: 5,
      });

      expect(result.commits).toHaveLength(0);
      expect(result.summary).toContain('No history found');
    });
  });

  describe('grouping and deduplication', () => {
    it('should group blame entries by unique commit SHA', async () => {
      const sha1 = 'aaaa234567890123456789012345678901234567';
      const sha2 = 'bbbb234567890123456789012345678901234567';

      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ commitSha: sha1, line: 1, authorDate: '2024-06-15T10:00:00.000Z' }),
        makeBlameEntry({ commitSha: sha1, line: 2, authorDate: '2024-06-15T10:00:00.000Z' }),
        makeBlameEntry({ commitSha: sha1, line: 3, authorDate: '2024-06-15T10:00:00.000Z' }),
        makeBlameEntry({ commitSha: sha2, line: 4, authorDate: '2024-06-14T10:00:00.000Z', author: 'Jane' }),
      ]);

      vi.mocked(mockAdapter.show).mockImplementation(async (sha: string) => ({
        sha,
        authorName: sha === sha1 ? 'John Doe' : 'Jane',
        authorEmail: 'test@example.com',
        date: sha === sha1 ? '2024-06-15T10:00:00.000Z' : '2024-06-14T10:00:00.000Z',
        message: sha === sha1 ? 'First commit' : 'Second commit',
        linesAdded: 5,
        linesDeleted: 2,
        filesChanged: ['file.ts'],
      }));

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 4,
      });

      expect(result.commits).toHaveLength(2);
      expect(result.commits[0].sha).toBe(sha1);
      expect(result.commits[1].sha).toBe(sha2);
    });

    it('should not have duplicate SHAs in results', async () => {
      const sha = 'cccc234567890123456789012345678901234567';

      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ commitSha: sha, line: 1 }),
        makeBlameEntry({ commitSha: sha, line: 2 }),
        makeBlameEntry({ commitSha: sha, line: 3 }),
        makeBlameEntry({ commitSha: sha, line: 4 }),
        makeBlameEntry({ commitSha: sha, line: 5 }),
      ]);

      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Single commit',
        linesAdded: 5,
        linesDeleted: 0,
        filesChanged: ['file.ts'],
      });

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 5,
      });

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].sha).toBe(sha);
    });
  });

  describe('ordering', () => {
    it('should order commits from most recent to oldest', async () => {
      const entries = [
        makeBlameEntry({
          commitSha: 'old0234567890123456789012345678901234567',
          authorDate: '2023-01-01T00:00:00.000Z',
          line: 1,
        }),
        makeBlameEntry({
          commitSha: 'mid0234567890123456789012345678901234567',
          authorDate: '2024-01-01T00:00:00.000Z',
          line: 2,
        }),
        makeBlameEntry({
          commitSha: 'new0234567890123456789012345678901234567',
          authorDate: '2024-06-01T00:00:00.000Z',
          line: 3,
        }),
      ];

      vi.mocked(mockAdapter.blame).mockResolvedValue(entries);
      vi.mocked(mockAdapter.show).mockImplementation(async (sha: string) => ({
        sha,
        authorName: 'Author',
        authorEmail: 'a@b.com',
        date: '',
        message: `Commit ${sha.slice(0, 4)}`,
        linesAdded: 1,
        linesDeleted: 0,
        filesChanged: [],
      }));

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 3,
      });

      expect(result.commits[0].sha).toBe('new0234567890123456789012345678901234567');
      expect(result.commits[1].sha).toBe('mid0234567890123456789012345678901234567');
      expect(result.commits[2].sha).toBe('old0234567890123456789012345678901234567');
    });
  });

  describe('max 10 commits cap', () => {
    it('should cap results at 10 commits', async () => {
      const entries: BlameEntry[] = [];
      for (let i = 0; i < 15; i++) {
        const sha = `${i.toString().padStart(4, '0')}234567890123456789012345678901234567`;
        entries.push(
          makeBlameEntry({
            commitSha: sha,
            line: i + 1,
            authorDate: new Date(2024, 0, i + 1).toISOString(),
          })
        );
      }

      vi.mocked(mockAdapter.blame).mockResolvedValue(entries);
      vi.mocked(mockAdapter.show).mockImplementation(async (sha: string) => ({
        sha,
        authorName: 'Author',
        authorEmail: 'a@b.com',
        date: '',
        message: 'Commit message',
        linesAdded: 1,
        linesDeleted: 0,
        filesChanged: [],
      }));

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.commits).toHaveLength(10);
    });
  });

  describe('PR extraction (Req 1.2)', () => {
    it('should extract PR from "(#123)" pattern', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Fix login validation (#123)',
        linesAdded: 5,
        linesDeleted: 2,
        filesChanged: ['auth.ts'],
      });

      const result = await analyzer.analyze({
        file: 'auth.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].pullRequest).toBeDefined();
      expect(result.commits[0].pullRequest!.number).toBe(123);
      expect(result.commits[0].pullRequest!.title).toBe('Fix login validation (#123)');
    });

    it('should extract PR from "Merge pull request #456" pattern', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Merge pull request #456 from feature/auth\n\nAdd OAuth support',
        linesAdded: 50,
        linesDeleted: 10,
        filesChanged: ['auth.ts'],
      });

      const result = await analyzer.analyze({
        file: 'auth.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].pullRequest).toBeDefined();
      expect(result.commits[0].pullRequest!.number).toBe(456);
    });

    it('should not include pullRequest when no PR reference exists', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Simple commit without PR',
        linesAdded: 1,
        linesDeleted: 0,
        filesChanged: ['file.ts'],
      });

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].pullRequest).toBeUndefined();
    });
  });

  describe('issue reference extraction', () => {
    it('should extract JIRA-style issue references', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Fix PROJ-456: handle null input',
        linesAdded: 3,
        linesDeleted: 1,
        filesChanged: ['parser.ts'],
      });

      const result = await analyzer.analyze({
        file: 'parser.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].issueRefs).toContain('PROJ-456');
    });

    it('should extract GitHub issue references', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Closes #789 - fix memory leak',
        linesAdded: 10,
        linesDeleted: 5,
        filesChanged: ['memory.ts'],
      });

      const result = await analyzer.analyze({
        file: 'memory.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].issueRefs).toContain('#789');
    });

    it('should return empty issueRefs when no references exist', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Refactor code for clarity',
        linesAdded: 20,
        linesDeleted: 15,
        filesChanged: ['utils.ts'],
      });

      const result = await analyzer.analyze({
        file: 'utils.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].issueRefs).toEqual([]);
    });
  });

  describe('natural language summary (Req 1.4)', () => {
    it('should include author and date in summary', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({
          line: 1,
          author: 'Alice Smith',
          authorDate: '2024-03-20T14:30:00.000Z',
        }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'Alice Smith',
        authorEmail: 'alice@example.com',
        date: '2024-03-20T14:30:00.000Z',
        message: 'Add input validation',
        linesAdded: 8,
        linesDeleted: 0,
        filesChanged: ['validator.ts'],
      });

      const result = await analyzer.analyze({
        file: 'validator.ts',
        startLine: 1,
        endLine: 1,
      });

      const summary = result.commits[0].naturalLanguageSummary;
      expect(summary).toContain('Alice Smith');
      expect(summary).toContain('2024-03-20');
    });

    it('should not exceed 500 characters', async () => {
      const longMessage = 'A'.repeat(600);
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: longMessage,
        linesAdded: 1,
        linesDeleted: 0,
        filesChanged: ['file.ts'],
      });

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].naturalLanguageSummary.length).toBeLessThanOrEqual(500);
    });

    it('should indicate when no PR or issue references found (Req 1.6)', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Simple refactor',
        linesAdded: 5,
        linesDeleted: 3,
        filesChanged: ['file.ts'],
      });

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].naturalLanguageSummary).toContain('No PR or issue references');
    });
  });

  describe('discussion summary (Req 1.3)', () => {
    it('should include discussion summary when issue refs exist', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Fix PROJ-123: handle edge case (#45)',
        linesAdded: 10,
        linesDeleted: 2,
        filesChanged: ['handler.ts'],
      });

      const result = await analyzer.analyze({
        file: 'handler.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].discussionSummary).toBeDefined();
      expect(result.commits[0].discussionSummary!.length).toBeLessThanOrEqual(300);
    });

    it('should not include discussion summary when no refs exist', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Simple change',
        linesAdded: 1,
        linesDeleted: 0,
        filesChanged: ['file.ts'],
      });

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 1,
      });

      expect(result.commits[0].discussionSummary).toBeUndefined();
    });
  });

  describe('show failure handling', () => {
    it('should handle show() failure gracefully', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 1 }),
      ]);
      vi.mocked(mockAdapter.show).mockRejectedValue(
        new Error('fatal: bad object abc123')
      );

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 1,
      });

      // Should still return a result with the commit, just with empty message
      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].sha).toBe('abc1234567890123456789012345678901234567');
      expect(result.commits[0].message).toBe('(no commit message)');
    });
  });

  describe('result structure', () => {
    it('should return correct file and lineRange', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ line: 10 }),
      ]);
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Commit',
        linesAdded: 1,
        linesDeleted: 0,
        filesChanged: ['src/app.ts'],
      });

      const result = await analyzer.analyze({
        file: 'src/app.ts',
        startLine: 10,
        endLine: 20,
      });

      expect(result.file).toBe('src/app.ts');
      expect(result.lineRange).toEqual({ start: 10, end: 20 });
    });

    it('should include overall summary with commit count and contributors', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([
        makeBlameEntry({ commitSha: 'aaa1234567890123456789012345678901234567', line: 1, author: 'Alice', authorDate: '2024-06-15T10:00:00.000Z' }),
        makeBlameEntry({ commitSha: 'bbb1234567890123456789012345678901234567', line: 2, author: 'Bob', authorDate: '2024-06-14T10:00:00.000Z' }),
      ]);
      vi.mocked(mockAdapter.show).mockImplementation(async (sha: string) => ({
        sha,
        authorName: 'Author',
        authorEmail: 'a@b.com',
        date: '',
        message: 'Commit',
        linesAdded: 1,
        linesDeleted: 0,
        filesChanged: [],
      }));

      const result = await analyzer.analyze({
        file: 'file.ts',
        startLine: 1,
        endLine: 2,
      });

      expect(result.summary).toContain('2 commit(s)');
      expect(result.summary).toContain('Alice');
      expect(result.summary).toContain('Bob');
    });
  });
});

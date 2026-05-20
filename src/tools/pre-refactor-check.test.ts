import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreRefactorSafetyChecker } from './pre-refactor-check.js';
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

function makeBlameEntries(count: number, sha: string): BlameEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeBlameEntry({ commitSha: sha, line: i + 1 })
  );
}

describe('PreRefactorSafetyChecker', () => {
  let checker: PreRefactorSafetyChecker;
  let mockAdapter: GitAdapter;

  beforeEach(() => {
    mockAdapter = createMockGitAdapter();
    checker = new PreRefactorSafetyChecker(mockAdapter);
  });

  describe('deletion line threshold', () => {
    it('should skip analysis when lines <= threshold (10)', async () => {
      const result = await checker.check({
        file: 'src/main.ts',
        startLine: 1,
        endLine: 10,
      });

      expect(result).toEqual({ safe: true, warnings: [], analysisCompleted: true });
      expect(mockAdapter.blame).not.toHaveBeenCalled();
    });

    it('should skip analysis for exactly 10 lines', async () => {
      const result = await checker.check({
        file: 'src/main.ts',
        startLine: 1,
        endLine: 10,
      });

      expect(result.safe).toBe(true);
      expect(result.analysisCompleted).toBe(true);
      expect(mockAdapter.blame).not.toHaveBeenCalled();
    });

    it('should trigger analysis for 11 lines (> threshold)', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue(
        makeBlameEntries(11, 'abc1234567890123456789012345678901234567')
      );
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Refactor code',
        linesAdded: 11,
        linesDeleted: 0,
        filesChanged: ['src/main.ts'],
      });

      const result = await checker.check({
        file: 'src/main.ts',
        startLine: 1,
        endLine: 11,
      });

      expect(mockAdapter.blame).toHaveBeenCalled();
      expect(result.analysisCompleted).toBe(true);
    });

    it('should respect custom deletion line threshold', async () => {
      const customChecker = new PreRefactorSafetyChecker(mockAdapter, {
        deletionLineThreshold: 5,
      });

      // 5 lines should NOT trigger
      const result1 = await customChecker.check({
        file: 'src/main.ts',
        startLine: 1,
        endLine: 5,
      });
      expect(mockAdapter.blame).not.toHaveBeenCalled();
      expect(result1.safe).toBe(true);

      // 6 lines SHOULD trigger
      vi.mocked(mockAdapter.blame).mockResolvedValue(
        makeBlameEntries(6, 'abc1234567890123456789012345678901234567')
      );
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha: 'abc1234567890123456789012345678901234567',
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Simple change',
        linesAdded: 6,
        linesDeleted: 0,
        filesChanged: ['src/main.ts'],
      });

      await customChecker.check({
        file: 'src/main.ts',
        startLine: 1,
        endLine: 6,
      });
      expect(mockAdapter.blame).toHaveBeenCalled();
    });
  });

  describe('keyword detection (Req 5.1, 5.2)', () => {
    it('should generate warning for "fix" keyword', async () => {
      const sha = 'fix1234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'John',
        authorEmail: 'john@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Fix null pointer exception in parser',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['parser.ts'],
      });

      const result = await checker.check({
        file: 'parser.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('high');
      expect(result.warnings[0].description).toContain('Fix null pointer');
      expect(result.warnings[0].commitSha).toBe(sha);
    });

    it('should generate warning for "bug" keyword', async () => {
      const sha = 'bug1234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(12, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Jane',
        authorEmail: 'jane@example.com',
        date: '2024-05-10T10:00:00.000Z',
        message: 'Bug: handle empty array input',
        linesAdded: 12,
        linesDeleted: 0,
        filesChanged: ['handler.ts'],
      });

      const result = await checker.check({
        file: 'handler.ts',
        startLine: 1,
        endLine: 12,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings[0].severity).toBe('high');
    });

    it('should generate warning for "edge case" keyword', async () => {
      const sha = 'edge234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(20, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Alice',
        authorEmail: 'alice@example.com',
        date: '2024-04-01T10:00:00.000Z',
        message: 'Handle edge case when user has no permissions',
        linesAdded: 20,
        linesDeleted: 0,
        filesChanged: ['auth.ts'],
      });

      const result = await checker.check({
        file: 'auth.ts',
        startLine: 1,
        endLine: 20,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings[0].severity).toBe('high');
    });

    it('should generate warning for "hotfix" keyword', async () => {
      const sha = 'hotf234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Bob',
        authorEmail: 'bob@example.com',
        date: '2024-03-15T10:00:00.000Z',
        message: 'Hotfix: prevent race condition in queue',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['queue.ts'],
      });

      const result = await checker.check({
        file: 'queue.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings[0].severity).toBe('high');
    });

    it('should generate warning for "workaround" keyword', async () => {
      const sha = 'work234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(12, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Carol',
        authorEmail: 'carol@example.com',
        date: '2024-02-20T10:00:00.000Z',
        message: 'Workaround for Chrome rendering issue',
        linesAdded: 12,
        linesDeleted: 0,
        filesChanged: ['render.ts'],
      });

      const result = await checker.check({
        file: 'render.ts',
        startLine: 1,
        endLine: 12,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings[0].severity).toBe('high');
    });

    it('should generate warning for "hack" keyword', async () => {
      const sha = 'hack234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(11, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Dave',
        authorEmail: 'dave@example.com',
        date: '2024-01-10T10:00:00.000Z',
        message: 'Hack to support legacy API format',
        linesAdded: 11,
        linesDeleted: 0,
        filesChanged: ['api.ts'],
      });

      const result = await checker.check({
        file: 'api.ts',
        startLine: 1,
        endLine: 11,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings[0].severity).toBe('high');
    });

    it('should detect keywords case-insensitively', async () => {
      const sha = 'case234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Eve',
        authorEmail: 'eve@example.com',
        date: '2024-06-01T10:00:00.000Z',
        message: 'FIX: Handle EDGE CASE in BUG report parser',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['report.ts'],
      });

      const result = await checker.check({
        file: 'report.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings[0].severity).toBe('high');
    });
  });

  describe('ticket reference detection', () => {
    it('should generate medium severity warning for ticket refs only', async () => {
      const sha = 'tick234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Frank',
        authorEmail: 'frank@example.com',
        date: '2024-06-10T10:00:00.000Z',
        message: 'PROJ-456: Add validation for user input',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['validator.ts'],
      });

      const result = await checker.check({
        file: 'validator.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('medium');
      expect(result.warnings[0].caseId).toBe('PROJ-456');
    });

    it('should use ticket identifier as caseId when available', async () => {
      const sha = 'jira234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(12, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Grace',
        authorEmail: 'grace@example.com',
        date: '2024-05-20T10:00:00.000Z',
        message: 'JIRA-123: Implement retry logic',
        linesAdded: 12,
        linesDeleted: 0,
        filesChanged: ['retry.ts'],
      });

      const result = await checker.check({
        file: 'retry.ts',
        startLine: 1,
        endLine: 12,
      });

      expect(result.warnings[0].caseId).toBe('JIRA-123');
    });

    it('should use short SHA as caseId when no ticket refs', async () => {
      const sha = 'noref34567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Hank',
        authorEmail: 'hank@example.com',
        date: '2024-04-15T10:00:00.000Z',
        message: 'Fix timeout issue in connection pool',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['pool.ts'],
      });

      const result = await checker.check({
        file: 'pool.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.warnings[0].caseId).toBe('noref34');
    });

    it('should prioritize high severity when both keywords and tickets present', async () => {
      const sha = 'both234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Ivy',
        authorEmail: 'ivy@example.com',
        date: '2024-06-05T10:00:00.000Z',
        message: 'Fix PROJ-789: handle null response from API',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['api-client.ts'],
      });

      const result = await checker.check({
        file: 'api-client.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.warnings[0].severity).toBe('high');
      expect(result.warnings[0].caseId).toBe('PROJ-789');
    });
  });

  describe('PR number extraction', () => {
    it('should extract PR number from "(#123)" pattern', async () => {
      const sha = 'pr12234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Jack',
        authorEmail: 'jack@example.com',
        date: '2024-06-12T10:00:00.000Z',
        message: 'Fix race condition in event handler (#42)',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['events.ts'],
      });

      const result = await checker.check({
        file: 'events.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.warnings[0].prNumber).toBe(42);
    });

    it('should extract PR number from "Merge pull request #N" pattern', async () => {
      const sha = 'mrpr234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Kate',
        authorEmail: 'kate@example.com',
        date: '2024-06-08T10:00:00.000Z',
        message: 'Merge pull request #99 from fix/memory-leak\n\nFix memory leak in cache',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['cache.ts'],
      });

      const result = await checker.check({
        file: 'cache.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.warnings[0].prNumber).toBe(99);
    });

    it('should not include prNumber when no PR reference exists', async () => {
      const sha = 'nopr234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Leo',
        authorEmail: 'leo@example.com',
        date: '2024-06-01T10:00:00.000Z',
        message: 'Fix: handle empty string input',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['input.ts'],
      });

      const result = await checker.check({
        file: 'input.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.warnings[0].prNumber).toBeUndefined();
    });
  });

  describe('no warnings case (Req 5.5)', () => {
    it('should return safe=true when no keywords or ticket refs found', async () => {
      const sha = 'safe234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Mike',
        authorEmail: 'mike@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Refactor: extract helper function',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['utils.ts'],
      });

      const result = await checker.check({
        file: 'utils.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.analysisCompleted).toBe(true);
    });

    it('should return safe=true for empty commit messages', async () => {
      const sha = 'empt234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Nancy',
        authorEmail: 'nancy@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: '',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['file.ts'],
      });

      const result = await checker.check({
        file: 'file.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('multiple commits', () => {
    it('should generate warnings for multiple commits with keywords', async () => {
      const sha1 = 'sha1234567890123456789012345678901234567';
      const sha2 = 'sha2234567890123456789012345678901234567';

      const entries = [
        ...makeBlameEntries(8, sha1).map((e, i) => ({ ...e, line: i + 1 })),
        ...makeBlameEntries(8, sha2).map((e, i) => ({ ...e, line: i + 9 })),
      ];

      vi.mocked(mockAdapter.blame).mockResolvedValue(entries);
      vi.mocked(mockAdapter.show).mockImplementation(async (sha: string) => ({
        sha,
        authorName: 'Author',
        authorEmail: 'a@b.com',
        date: '2024-06-15T10:00:00.000Z',
        message: sha === sha1
          ? 'Fix: handle null input'
          : 'Bug: prevent infinite loop',
        linesAdded: 8,
        linesDeleted: 0,
        filesChanged: ['file.ts'],
      }));

      const result = await checker.check({
        file: 'file.ts',
        startLine: 1,
        endLine: 16,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings).toHaveLength(2);
    });

    it('should only warn for commits with keywords, not all commits', async () => {
      const sha1 = 'safe134567890123456789012345678901234567';
      const sha2 = 'warn234567890123456789012345678901234567';

      const entries = [
        ...makeBlameEntries(6, sha1).map((e, i) => ({ ...e, line: i + 1 })),
        ...makeBlameEntries(6, sha2).map((e, i) => ({ ...e, line: i + 7 })),
      ];

      vi.mocked(mockAdapter.blame).mockResolvedValue(entries);
      vi.mocked(mockAdapter.show).mockImplementation(async (sha: string) => ({
        sha,
        authorName: 'Author',
        authorEmail: 'a@b.com',
        date: '2024-06-15T10:00:00.000Z',
        message: sha === sha1
          ? 'Refactor: clean up code'
          : 'Fix: handle edge-case in parser',
        linesAdded: 6,
        linesDeleted: 0,
        filesChanged: ['file.ts'],
      }));

      const result = await checker.check({
        file: 'file.ts',
        startLine: 1,
        endLine: 12,
      });

      expect(result.safe).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].commitSha).toBe(sha2);
    });
  });

  describe('timeout handling (Req 5.6)', () => {
    it('should return analysisCompleted=false on timeout', async () => {
      const timeoutChecker = new PreRefactorSafetyChecker(mockAdapter, {
        timeoutMs: 10, // Very short timeout
      });

      vi.mocked(mockAdapter.blame).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(makeBlameEntries(15, 'abc1234567890123456789012345678901234567')), 50))
      );

      const result = await timeoutChecker.check({
        file: 'slow.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.analysisCompleted).toBe(false);
    });

    it('should return safe=true on timeout (non-blocking)', async () => {
      const timeoutChecker = new PreRefactorSafetyChecker(mockAdapter, {
        timeoutMs: 10,
      });

      vi.mocked(mockAdapter.blame).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(makeBlameEntries(15, 'abc1234567890123456789012345678901234567')), 100))
      );

      const result = await timeoutChecker.check({
        file: 'slow.ts',
        startLine: 1,
        endLine: 15,
      });

      expect(result.safe).toBe(true);
    });
  });

  describe('missing git history handling (Req 5.6)', () => {
    it('should handle blame failure gracefully', async () => {
      vi.mocked(mockAdapter.blame).mockRejectedValue(
        new Error("fatal: no such path 'missing.ts' in HEAD")
      );

      const result = await checker.check({
        file: 'missing.ts',
        startLine: 1,
        endLine: 20,
      });

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.analysisCompleted).toBe(false);
    });

    it('should handle show() failure for individual commits gracefully', async () => {
      const sha1 = 'good234567890123456789012345678901234567';
      const sha2 = 'fail234567890123456789012345678901234567';

      const entries = [
        ...makeBlameEntries(6, sha1).map((e, i) => ({ ...e, line: i + 1 })),
        ...makeBlameEntries(6, sha2).map((e, i) => ({ ...e, line: i + 7 })),
      ];

      vi.mocked(mockAdapter.blame).mockResolvedValue(entries);
      vi.mocked(mockAdapter.show).mockImplementation(async (sha: string) => {
        if (sha === sha2) {
          throw new Error('fatal: bad object');
        }
        return {
          sha,
          authorName: 'Author',
          authorEmail: 'a@b.com',
          date: '2024-06-15T10:00:00.000Z',
          message: 'Fix: handle null input',
          linesAdded: 6,
          linesDeleted: 0,
          filesChanged: ['file.ts'],
        };
      });

      const result = await checker.check({
        file: 'file.ts',
        startLine: 1,
        endLine: 12,
      });

      // Should still process the successful commit
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].commitSha).toBe(sha1);
      expect(result.analysisCompleted).toBe(true);
    });

    it('should return empty warnings when blame returns empty', async () => {
      vi.mocked(mockAdapter.blame).mockResolvedValue([]);

      const result = await checker.check({
        file: 'empty.ts',
        startLine: 1,
        endLine: 20,
      });

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.analysisCompleted).toBe(true);
    });
  });

  describe('warning structure', () => {
    it('should include all required fields in warning', async () => {
      const sha = 'full234567890123456789012345678901234567';
      vi.mocked(mockAdapter.blame).mockResolvedValue(makeBlameEntries(15, sha));
      vi.mocked(mockAdapter.show).mockResolvedValue({
        sha,
        authorName: 'Oscar',
        authorEmail: 'oscar@example.com',
        date: '2024-06-15T10:00:00.000Z',
        message: 'Fix PROJ-100: handle timeout in API call (#55)',
        linesAdded: 15,
        linesDeleted: 0,
        filesChanged: ['api.ts'],
      });

      const result = await checker.check({
        file: 'api.ts',
        startLine: 1,
        endLine: 15,
      });

      const warning = result.warnings[0];
      expect(warning.caseId).toBe('PROJ-100');
      expect(warning.description).toBe('Fix PROJ-100: handle timeout in API call (#55)');
      expect(warning.commitSha).toBe(sha);
      expect(warning.prNumber).toBe(55);
      expect(warning.severity).toBe('high');
    });
  });
});

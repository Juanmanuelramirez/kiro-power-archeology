import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeGraphBuilder } from './graph-builder.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import type { GitAdapter, CommitEntry, CommitDetail, FileNumStat } from '../types/index.js';

/**
 * Creates a mock GitAdapter for testing.
 */
function createMockGitAdapter(overrides: Partial<GitAdapter> = {}): GitAdapter {
  return {
    blame: vi.fn().mockResolvedValue([]),
    log: vi.fn().mockResolvedValue([]),
    logFollow: vi.fn().mockResolvedValue([]),
    show: vi.fn().mockResolvedValue({
      sha: '', authorName: '', authorEmail: '', date: '',
      message: '', linesAdded: 0, linesDeleted: 0, filesChanged: [],
    }),
    getRepoRoot: vi.fn().mockResolvedValue('/repo'),
    getGitDir: vi.fn().mockResolvedValue('/repo/.git'),
    isValidRepo: vi.fn().mockResolvedValue(true),
    diffStat: vi.fn().mockResolvedValue([]),
    numstat: vi.fn().mockResolvedValue([]),
    getNewCommits: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCommit(sha: string, opts: Partial<CommitEntry> = {}): CommitEntry {
  return {
    sha,
    authorName: opts.authorName ?? 'Test Author',
    authorEmail: opts.authorEmail ?? 'test@example.com',
    date: opts.date ?? '2024-01-15T10:00:00Z',
    message: opts.message ?? `Commit ${sha}`,
  };
}

describe('KnowledgeGraphBuilder', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  describe('initialize', () => {
    it('should set state to not-initialized for a valid empty repo', async () => {
      const git = createMockGitAdapter();
      const builder = new KnowledgeGraphBuilder(git, store);

      await builder.initialize('/repo');

      const status = await builder.getStatus();
      expect(status.state).toBe('not-initialized');
    });

    it('should set state to ready if store already has commits', async () => {
      // Pre-populate the store
      store.createCommit({
        sha: 'abc123',
        author_name: 'Test',
        author_email: 'test@test.com',
        authored_date: '2024-01-01T00:00:00Z',
        message: 'initial',
      });

      const git = createMockGitAdapter();
      const builder = new KnowledgeGraphBuilder(git, store);

      await builder.initialize('/repo');

      const status = await builder.getStatus();
      expect(status.state).toBe('ready');
      expect(builder.isReady()).toBe(true);
    });

    it('should set state to error for invalid repo', async () => {
      const git = createMockGitAdapter({
        isValidRepo: vi.fn().mockResolvedValue(false),
      });
      const builder = new KnowledgeGraphBuilder(git, store);

      await builder.initialize('/not-a-repo');

      const status = await builder.getStatus();
      expect(status.state).toBe('error');
      expect(status.error).toContain('Not a valid git repository');
      expect(builder.isReady()).toBe(false);
    });

    it('should handle exceptions gracefully', async () => {
      const git = createMockGitAdapter({
        isValidRepo: vi.fn().mockRejectedValue(new Error('git not found')),
      });
      const builder = new KnowledgeGraphBuilder(git, store);

      await builder.initialize('/repo');

      const status = await builder.getStatus();
      expect(status.state).toBe('error');
      expect(status.error).toBe('git not found');
    });
  });

  describe('buildInitial', () => {
    it('should handle empty repository', async () => {
      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue([]),
      });
      const builder = new KnowledgeGraphBuilder(git, store);

      const result = await builder.buildInitial();

      expect(result.state).toBe('ready');
      expect(result.processed).toBe(0);
      expect(result.total).toBe(0);
      expect(builder.isReady()).toBe(true);
    });

    it('should process commits and create nodes', async () => {
      const commits: CommitEntry[] = [
        makeCommit('sha1', { date: '2024-01-02T00:00:00Z', message: 'Second commit' }),
        makeCommit('sha2', { date: '2024-01-01T00:00:00Z', message: 'First commit' }),
      ];

      const numstatResults: Record<string, FileNumStat[]> = {
        sha1: [{ file: 'src/app.ts', added: 10, deleted: 2 }],
        sha2: [{ file: 'src/app.ts', added: 20, deleted: 0 }, { file: 'README.md', added: 5, deleted: 0 }],
      };

      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue(commits),
        numstat: vi.fn().mockImplementation((sha: string) => {
          return Promise.resolve(numstatResults[sha] ?? []);
        }),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      const result = await builder.buildInitial();

      expect(result.state).toBe('ready');
      expect(result.processed).toBe(2);
      expect(result.total).toBe(2);

      // Verify nodes were created
      const nodeCounts = store.getNodeCounts();
      expect(nodeCounts.commits).toBe(2);
      expect(nodeCounts.files).toBe(2);
      expect(nodeCounts.authors).toBe(1);
    });

    it('should extract tickets from commit messages', async () => {
      const commits: CommitEntry[] = [
        makeCommit('sha1', { message: 'Fix JIRA-123: resolve login bug' }),
        makeCommit('sha2', { message: 'Closes #456 and PROJ-789' }),
      ];

      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue(commits),
        numstat: vi.fn().mockResolvedValue([{ file: 'src/auth.ts', added: 5, deleted: 2 }]),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.buildInitial();

      const nodeCounts = store.getNodeCounts();
      expect(nodeCounts.tickets).toBeGreaterThanOrEqual(3); // JIRA-123, #456, PROJ-789
    });

    it('should create author nodes and update commit counts', async () => {
      const commits: CommitEntry[] = [
        makeCommit('sha1', { authorEmail: 'alice@test.com', authorName: 'Alice', date: '2024-01-02T00:00:00Z' }),
        makeCommit('sha2', { authorEmail: 'alice@test.com', authorName: 'Alice', date: '2024-01-01T00:00:00Z' }),
        makeCommit('sha3', { authorEmail: 'bob@test.com', authorName: 'Bob', date: '2024-01-01T00:00:00Z' }),
      ];

      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue(commits),
        numstat: vi.fn().mockResolvedValue([]),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.buildInitial();

      const nodeCounts = store.getNodeCounts();
      expect(nodeCounts.authors).toBe(2);

      const alice = store.getAuthorByEmail('alice@test.com');
      expect(alice).not.toBeNull();
      expect(alice!.total_commits).toBe(2);

      const bob = store.getAuthorByEmail('bob@test.com');
      expect(bob).not.toBeNull();
      expect(bob!.total_commits).toBe(1);
    });

    it('should handle errors and set state to error', async () => {
      const git = createMockGitAdapter({
        log: vi.fn().mockRejectedValue(new Error('git log failed')),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      const result = await builder.buildInitial();

      expect(result.state).toBe('error');
      expect(result.error).toBe('git log failed');
      expect(builder.isReady()).toBe(false);
    });

    it('should fall back to show when numstat fails', async () => {
      const commits: CommitEntry[] = [
        makeCommit('sha1', { message: 'Initial commit' }),
      ];

      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue(commits),
        numstat: vi.fn().mockRejectedValue(new Error('no parent')),
        show: vi.fn().mockResolvedValue({
          sha: 'sha1',
          authorName: 'Test',
          authorEmail: 'test@example.com',
          date: '2024-01-01T00:00:00Z',
          message: 'Initial commit',
          linesAdded: 10,
          linesDeleted: 0,
          filesChanged: ['src/index.ts', 'package.json'],
        } as CommitDetail),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      const result = await builder.buildInitial();

      expect(result.state).toBe('ready');
      const nodeCounts = store.getNodeCounts();
      expect(nodeCounts.files).toBe(2);
    });

    it('should not duplicate commits on repeated builds', async () => {
      const commits: CommitEntry[] = [
        makeCommit('sha1', { message: 'First' }),
      ];

      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue(commits),
        numstat: vi.fn().mockResolvedValue([{ file: 'a.ts', added: 1, deleted: 0 }]),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.buildInitial();
      await builder.buildInitial();

      const nodeCounts = store.getNodeCounts();
      expect(nodeCounts.commits).toBe(1);
    });
  });

  describe('updateIncremental', () => {
    it('should return zero counts when no new commits', async () => {
      const git = createMockGitAdapter({
        getNewCommits: vi.fn().mockResolvedValue([]),
      });

      // Pre-populate store so getLastCommitSha returns something
      store.createCommit({
        sha: 'existing',
        author_name: 'Test',
        author_email: 'test@test.com',
        authored_date: '2024-01-01T00:00:00Z',
        message: 'existing',
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      const result = await builder.updateIncremental();

      expect(result.newCommits).toBe(0);
      expect(result.newFiles).toBe(0);
      expect(result.newAuthors).toBe(0);
      expect(result.newTickets).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should process only new commits', async () => {
      // Pre-populate store with an existing commit
      store.createCommit({
        sha: 'old-sha',
        author_name: 'Test',
        author_email: 'test@test.com',
        authored_date: '2024-01-01T00:00:00Z',
        message: 'old commit',
      });
      store.createAuthor({
        name: 'Test',
        email: 'test@test.com',
        total_commits: 1,
        first_seen: '2024-01-01T00:00:00Z',
        last_seen: '2024-01-01T00:00:00Z',
      });

      const newCommits: CommitEntry[] = [
        makeCommit('new-sha1', { authorEmail: 'test@test.com', date: '2024-01-02T00:00:00Z' }),
        makeCommit('new-sha2', { authorEmail: 'new@test.com', authorName: 'New Dev', date: '2024-01-03T00:00:00Z' }),
      ];

      const git = createMockGitAdapter({
        getNewCommits: vi.fn().mockResolvedValue(newCommits),
        numstat: vi.fn().mockResolvedValue([{ file: 'new-file.ts', added: 10, deleted: 0 }]),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      const result = await builder.updateIncremental();

      expect(result.newCommits).toBe(2);
      expect(result.newAuthors).toBe(1); // new@test.com is new
      expect(result.newFiles).toBe(1); // new-file.ts created once
      expect(builder.isReady()).toBe(true);
    });

    it('should preserve existing data', async () => {
      // Pre-populate
      store.createCommit({
        sha: 'old-sha',
        author_name: 'Old Author',
        author_email: 'old@test.com',
        authored_date: '2024-01-01T00:00:00Z',
        message: 'old commit',
      });
      store.createAuthor({
        name: 'Old Author',
        email: 'old@test.com',
        total_commits: 1,
        first_seen: '2024-01-01T00:00:00Z',
        last_seen: '2024-01-01T00:00:00Z',
      });
      store.createFile({ current_path: 'old-file.ts', first_commit_sha: 'old-sha' });

      const git = createMockGitAdapter({
        getNewCommits: vi.fn().mockResolvedValue([
          makeCommit('new-sha', { authorEmail: 'new@test.com', authorName: 'New' }),
        ]),
        numstat: vi.fn().mockResolvedValue([{ file: 'new-file.ts', added: 5, deleted: 0 }]),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.updateIncremental();

      // Old data should still be there
      expect(store.getCommitBySha('old-sha')).not.toBeNull();
      expect(store.getAuthorByEmail('old@test.com')).not.toBeNull();
      expect(store.getFileByPath('old-file.ts')).not.toBeNull();

      // New data should be added
      expect(store.getCommitBySha('new-sha')).not.toBeNull();
      expect(store.getAuthorByEmail('new@test.com')).not.toBeNull();
      expect(store.getFileByPath('new-file.ts')).not.toBeNull();
    });
  });

  describe('getStatus', () => {
    it('should report not-initialized state initially', async () => {
      const git = createMockGitAdapter();
      const builder = new KnowledgeGraphBuilder(git, store);

      const status = await builder.getStatus();
      expect(status.state).toBe('not-initialized');
      expect(status.lastUpdated).toBeNull();
      expect(status.totalNodes.files).toBe(0);
      expect(status.totalNodes.commits).toBe(0);
      expect(status.totalNodes.authors).toBe(0);
      expect(status.totalNodes.tickets).toBe(0);
    });

    it('should report node counts after build', async () => {
      const commits: CommitEntry[] = [
        makeCommit('sha1', { message: 'Fix PROJ-100' }),
        makeCommit('sha2', { authorEmail: 'other@test.com', authorName: 'Other' }),
      ];

      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue(commits),
        numstat: vi.fn().mockResolvedValue([{ file: 'app.ts', added: 1, deleted: 0 }]),
        logFollow: vi.fn().mockResolvedValue([]),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.buildInitial();

      const status = await builder.getStatus();
      expect(status.state).toBe('ready');
      expect(status.totalNodes.commits).toBe(2);
      expect(status.totalNodes.authors).toBe(2);
      expect(status.totalNodes.files).toBe(1);
      expect(status.totalNodes.tickets).toBeGreaterThanOrEqual(1);
      expect(status.lastUpdated).not.toBeNull();
    });
  });

  describe('isReady', () => {
    it('should return false before initialization', () => {
      const git = createMockGitAdapter();
      const builder = new KnowledgeGraphBuilder(git, store);
      expect(builder.isReady()).toBe(false);
    });

    it('should return true after successful build', async () => {
      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue([]),
        logFollow: vi.fn().mockResolvedValue([]),
      });
      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.buildInitial();
      expect(builder.isReady()).toBe(true);
    });

    it('should return false after error', async () => {
      const git = createMockGitAdapter({
        log: vi.fn().mockRejectedValue(new Error('fail')),
      });
      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.buildInitial();
      expect(builder.isReady()).toBe(false);
    });
  });

  describe('file rename tracking', () => {
    it('should detect renames via logFollow and merge file nodes', async () => {
      // Simulate: file was originally at 'old/path.ts', renamed to 'new/path.ts'
      const commits: CommitEntry[] = [
        makeCommit('sha-rename', { date: '2024-01-02T00:00:00Z', message: 'Rename file' }),
        makeCommit('sha-create', { date: '2024-01-01T00:00:00Z', message: 'Create file' }),
      ];

      const numstatResults: Record<string, FileNumStat[]> = {
        'sha-rename': [{ file: 'new/path.ts', added: 0, deleted: 0 }],
        'sha-create': [{ file: 'old/path.ts', added: 10, deleted: 0 }],
      };

      // logFollow for 'new/path.ts' returns both commits (showing the file history across rename)
      const followHistory: CommitEntry[] = [
        makeCommit('sha-rename', { date: '2024-01-02T00:00:00Z', message: 'Rename file' }),
        makeCommit('sha-create', { date: '2024-01-01T00:00:00Z', message: 'Create file' }),
      ];

      const git = createMockGitAdapter({
        log: vi.fn().mockResolvedValue(commits),
        numstat: vi.fn().mockImplementation((sha: string) => {
          return Promise.resolve(numstatResults[sha] ?? []);
        }),
        logFollow: vi.fn().mockImplementation((file: string) => {
          if (file === 'new/path.ts') return Promise.resolve(followHistory);
          return Promise.resolve([]);
        }),
      });

      const builder = new KnowledgeGraphBuilder(git, store);
      await builder.buildInitial();

      // After rename tracking, 'old/path.ts' should be merged into 'new/path.ts'
      const newFile = store.getFileByPath('new/path.ts');
      expect(newFile).not.toBeNull();
      expect(newFile!.previous_paths).toContain('old/path.ts');

      // The old file node should be removed
      const oldFile = store.getFileByPath('old/path.ts');
      expect(oldFile).toBeNull();
    });
  });
});

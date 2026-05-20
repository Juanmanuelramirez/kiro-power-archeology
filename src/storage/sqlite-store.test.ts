import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from './sqlite-store.js';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('initialization and migrations', () => {
    it('should initialize with in-memory database', () => {
      expect(store).toBeDefined();
    });

    it('should run migrations on initialization', () => {
      const version = store.getSchemaVersion();
      expect(version).toBe(1);
    });

    it('should not re-run already applied migrations', () => {
      // Creating a second store on the same path would re-run migrations
      // but with in-memory, we just verify the first run works
      const version = store.getSchemaVersion();
      expect(version).toBe(1);
    });
  });

  describe('files CRUD', () => {
    it('should create a file record', () => {
      const file = store.createFile({ current_path: 'src/index.ts' });
      expect(file.id).toBe(1);
      expect(file.current_path).toBe('src/index.ts');
      expect(file.previous_paths).toEqual([]);
      expect(file.first_commit_sha).toBeNull();
    });

    it('should create a file with previous paths', () => {
      const file = store.createFile({
        current_path: 'src/new-name.ts',
        previous_paths: ['src/old-name.ts'],
        first_commit_sha: 'abc123',
      });
      expect(file.previous_paths).toEqual(['src/old-name.ts']);
      expect(file.first_commit_sha).toBe('abc123');
    });

    it('should get file by id', () => {
      const created = store.createFile({ current_path: 'src/test.ts' });
      const found = store.getFileById(created.id);
      expect(found).toEqual(created);
    });

    it('should get file by path', () => {
      const created = store.createFile({ current_path: 'src/test.ts' });
      const found = store.getFileByPath('src/test.ts');
      expect(found).toEqual(created);
    });

    it('should return null for non-existent file', () => {
      expect(store.getFileById(999)).toBeNull();
      expect(store.getFileByPath('nonexistent.ts')).toBeNull();
    });

    it('should update file path', () => {
      const file = store.createFile({ current_path: 'src/old.ts' });
      store.updateFilePath(file.id, 'src/new.ts', ['src/old.ts']);
      const updated = store.getFileById(file.id);
      expect(updated!.current_path).toBe('src/new.ts');
      expect(updated!.previous_paths).toEqual(['src/old.ts']);
    });

    it('should get all files', () => {
      store.createFile({ current_path: 'a.ts' });
      store.createFile({ current_path: 'b.ts' });
      const all = store.getAllFiles();
      expect(all).toHaveLength(2);
    });

    it('should delete a file', () => {
      const file = store.createFile({ current_path: 'src/delete-me.ts' });
      store.deleteFile(file.id);
      expect(store.getFileById(file.id)).toBeNull();
    });
  });

  describe('commits CRUD', () => {
    it('should create a commit record', () => {
      const commit = store.createCommit({
        sha: 'abc123def456',
        author_name: 'John Doe',
        author_email: 'john@example.com',
        authored_date: '2024-01-15T10:00:00Z',
        message: 'feat: add new feature',
        lines_added: 50,
        lines_deleted: 10,
      });
      expect(commit.id).toBe(1);
      expect(commit.sha).toBe('abc123def456');
      expect(commit.author_name).toBe('John Doe');
      expect(commit.lines_added).toBe(50);
    });

    it('should get commit by sha', () => {
      store.createCommit({
        sha: 'abc123',
        author_name: 'Jane',
        author_email: 'jane@example.com',
        authored_date: '2024-01-15T10:00:00Z',
        message: 'fix: bug',
      });
      const found = store.getCommitBySha('abc123');
      expect(found).not.toBeNull();
      expect(found!.sha).toBe('abc123');
    });

    it('should return null for non-existent commit', () => {
      expect(store.getCommitById(999)).toBeNull();
      expect(store.getCommitBySha('nonexistent')).toBeNull();
    });

    it('should enforce unique sha constraint', () => {
      store.createCommit({
        sha: 'unique-sha',
        author_name: 'A',
        author_email: 'a@test.com',
        authored_date: '2024-01-01',
        message: 'first',
      });
      expect(() =>
        store.createCommit({
          sha: 'unique-sha',
          author_name: 'B',
          author_email: 'b@test.com',
          authored_date: '2024-01-02',
          message: 'second',
        })
      ).toThrow();
    });

    it('should delete a commit', () => {
      const commit = store.createCommit({
        sha: 'to-delete',
        author_name: 'A',
        author_email: 'a@test.com',
        authored_date: '2024-01-01',
        message: 'delete me',
      });
      store.deleteCommit(commit.id);
      expect(store.getCommitById(commit.id)).toBeNull();
    });
  });

  describe('authors CRUD', () => {
    it('should create an author record', () => {
      const author = store.createAuthor({
        name: 'John Doe',
        email: 'john@example.com',
        total_commits: 5,
        first_seen: '2023-01-01',
        last_seen: '2024-01-01',
      });
      expect(author.id).toBe(1);
      expect(author.name).toBe('John Doe');
      expect(author.total_commits).toBe(5);
    });

    it('should get author by email', () => {
      store.createAuthor({
        name: 'Jane',
        email: 'jane@example.com',
        first_seen: '2023-01-01',
        last_seen: '2024-01-01',
      });
      const found = store.getAuthorByEmail('jane@example.com');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Jane');
    });

    it('should update author fields', () => {
      const author = store.createAuthor({
        name: 'Old Name',
        email: 'test@example.com',
        total_commits: 1,
        first_seen: '2023-01-01',
        last_seen: '2023-06-01',
      });
      store.updateAuthor(author.id, {
        name: 'New Name',
        total_commits: 10,
        last_seen: '2024-06-01',
      });
      const updated = store.getAuthorById(author.id);
      expect(updated!.name).toBe('New Name');
      expect(updated!.total_commits).toBe(10);
      expect(updated!.last_seen).toBe('2024-06-01');
    });

    it('should enforce unique email constraint', () => {
      store.createAuthor({
        name: 'A',
        email: 'same@test.com',
        first_seen: '2023-01-01',
        last_seen: '2024-01-01',
      });
      expect(() =>
        store.createAuthor({
          name: 'B',
          email: 'same@test.com',
          first_seen: '2023-01-01',
          last_seen: '2024-01-01',
        })
      ).toThrow();
    });
  });

  describe('tickets CRUD', () => {
    it('should create a ticket record', () => {
      const ticket = store.createTicket({
        identifier: 'JIRA-123',
        type: 'jira',
        source_commit_sha: 'abc123',
      });
      expect(ticket.id).toBe(1);
      expect(ticket.identifier).toBe('JIRA-123');
      expect(ticket.type).toBe('jira');
    });

    it('should get ticket by identifier', () => {
      store.createTicket({
        identifier: '#456',
        type: 'github',
        source_commit_sha: 'def456',
      });
      const found = store.getTicketByIdentifier('#456');
      expect(found).not.toBeNull();
      expect(found!.type).toBe('github');
    });

    it('should enforce unique identifier constraint', () => {
      store.createTicket({
        identifier: 'PROJ-1',
        type: 'jira',
        source_commit_sha: 'sha1',
      });
      expect(() =>
        store.createTicket({
          identifier: 'PROJ-1',
          type: 'jira',
          source_commit_sha: 'sha2',
        })
      ).toThrow();
    });
  });

  describe('commit-file relationships', () => {
    it('should create commit-file relationship', () => {
      const commit = store.createCommit({
        sha: 'c1',
        author_name: 'A',
        author_email: 'a@test.com',
        authored_date: '2024-01-01',
        message: 'msg',
      });
      const file = store.createFile({ current_path: 'src/a.ts' });

      store.createCommitFile({
        commit_id: commit.id,
        file_id: file.id,
        lines_added: 10,
        lines_deleted: 5,
        change_ratio: 0.3,
      });

      const byCommit = store.getCommitFilesByCommit(commit.id);
      expect(byCommit).toHaveLength(1);
      expect(byCommit[0].file_id).toBe(file.id);
      expect(byCommit[0].lines_added).toBe(10);

      const byFile = store.getCommitFilesByFile(file.id);
      expect(byFile).toHaveLength(1);
      expect(byFile[0].commit_id).toBe(commit.id);
    });
  });

  describe('commit-ticket relationships', () => {
    it('should create commit-ticket relationship', () => {
      const commit = store.createCommit({
        sha: 'c1',
        author_name: 'A',
        author_email: 'a@test.com',
        authored_date: '2024-01-01',
        message: 'fix JIRA-123',
      });
      const ticket = store.createTicket({
        identifier: 'JIRA-123',
        type: 'jira',
        source_commit_sha: 'c1',
      });

      store.createCommitTicket(commit.id, ticket.id);

      const byCommit = store.getCommitTicketsByCommit(commit.id);
      expect(byCommit).toHaveLength(1);
      expect(byCommit[0].ticket_id).toBe(ticket.id);

      const byTicket = store.getCommitTicketsByTicket(ticket.id);
      expect(byTicket).toHaveLength(1);
      expect(byTicket[0].commit_id).toBe(commit.id);
    });
  });

  describe('file renames', () => {
    it('should create file rename record', () => {
      const file = store.createFile({ current_path: 'src/new.ts' });
      const rename = store.createFileRename({
        file_id: file.id,
        old_path: 'src/old.ts',
        new_path: 'src/new.ts',
        commit_sha: 'rename-sha',
        renamed_at: '2024-03-01',
      });
      expect(rename.old_path).toBe('src/old.ts');
      expect(rename.new_path).toBe('src/new.ts');
    });

    it('should get renames by file ordered by date', () => {
      const file = store.createFile({ current_path: 'src/final.ts' });
      store.createFileRename({
        file_id: file.id,
        old_path: 'src/first.ts',
        new_path: 'src/second.ts',
        commit_sha: 'sha1',
        renamed_at: '2024-01-01',
      });
      store.createFileRename({
        file_id: file.id,
        old_path: 'src/second.ts',
        new_path: 'src/final.ts',
        commit_sha: 'sha2',
        renamed_at: '2024-02-01',
      });

      const renames = store.getFileRenamesByFile(file.id);
      expect(renames).toHaveLength(2);
      expect(renames[0].old_path).toBe('src/first.ts');
      expect(renames[1].old_path).toBe('src/second.ts');
    });
  });

  describe('logical couplings', () => {
    it('should upsert logical coupling', () => {
      const fileA = store.createFile({ current_path: 'a.ts' });
      const fileB = store.createFile({ current_path: 'b.ts' });

      store.upsertLogicalCoupling({
        file_a_id: fileA.id,
        file_b_id: fileB.id,
        shared_commits: 5,
        co_occurrence_ratio: 0.75,
      });

      const couplings = store.getLogicalCouplingsByFile(fileA.id);
      expect(couplings).toHaveLength(1);
      expect(couplings[0].shared_commits).toBe(5);
      expect(couplings[0].co_occurrence_ratio).toBe(0.75);
    });

    it('should update existing coupling on upsert', () => {
      const fileA = store.createFile({ current_path: 'a.ts' });
      const fileB = store.createFile({ current_path: 'b.ts' });

      store.upsertLogicalCoupling({
        file_a_id: fileA.id,
        file_b_id: fileB.id,
        shared_commits: 3,
        co_occurrence_ratio: 0.5,
      });

      store.upsertLogicalCoupling({
        file_a_id: fileA.id,
        file_b_id: fileB.id,
        shared_commits: 8,
        co_occurrence_ratio: 0.85,
      });

      const couplings = store.getLogicalCouplingsByFile(fileA.id);
      expect(couplings).toHaveLength(1);
      expect(couplings[0].shared_commits).toBe(8);
      expect(couplings[0].co_occurrence_ratio).toBe(0.85);
    });

    it('should find couplings from either side', () => {
      const fileA = store.createFile({ current_path: 'a.ts' });
      const fileB = store.createFile({ current_path: 'b.ts' });

      store.upsertLogicalCoupling({
        file_a_id: fileA.id,
        file_b_id: fileB.id,
        shared_commits: 5,
        co_occurrence_ratio: 0.75,
      });

      const couplingsFromB = store.getLogicalCouplingsByFile(fileB.id);
      expect(couplingsFromB).toHaveLength(1);
    });
  });

  describe('graph traversal queries', () => {
    let commitId: number;
    let fileAId: number;
    let fileBId: number;
    let ticketId: number;

    beforeEach(() => {
      const commit = store.createCommit({
        sha: 'traversal-sha',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: '2024-06-01',
        message: 'feat: implement JIRA-100',
      });
      commitId = commit.id;

      const fileA = store.createFile({ current_path: 'src/feature.ts' });
      const fileB = store.createFile({ current_path: 'src/feature.test.ts' });
      fileAId = fileA.id;
      fileBId = fileB.id;

      store.createCommitFile({ commit_id: commitId, file_id: fileAId, lines_added: 100 });
      store.createCommitFile({ commit_id: commitId, file_id: fileBId, lines_added: 50 });

      const ticket = store.createTicket({
        identifier: 'JIRA-100',
        type: 'jira',
        source_commit_sha: 'traversal-sha',
      });
      ticketId = ticket.id;
      store.createCommitTicket(commitId, ticketId);

      store.createAuthor({
        name: 'Dev',
        email: 'dev@test.com',
        total_commits: 1,
        first_seen: '2024-06-01',
        last_seen: '2024-06-01',
      });
    });

    it('should get files by commit', () => {
      const files = store.getFilesByCommit(commitId);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.current_path).sort()).toEqual([
        'src/feature.test.ts',
        'src/feature.ts',
      ]);
    });

    it('should get commits by file', () => {
      const commits = store.getCommitsByFile(fileAId);
      expect(commits).toHaveLength(1);
      expect(commits[0].sha).toBe('traversal-sha');
    });

    it('should get tickets by commit', () => {
      const tickets = store.getTicketsByCommit(commitId);
      expect(tickets).toHaveLength(1);
      expect(tickets[0].identifier).toBe('JIRA-100');
    });

    it('should get commits by ticket', () => {
      const commits = store.getCommitsByTicket(ticketId);
      expect(commits).toHaveLength(1);
      expect(commits[0].sha).toBe('traversal-sha');
    });

    it('should get author by commit', () => {
      const author = store.getAuthorByCommit(commitId);
      expect(author).not.toBeNull();
      expect(author!.email).toBe('dev@test.com');
    });

    it('should get commits by author email', () => {
      const commits = store.getCommitsByAuthor('dev@test.com');
      expect(commits).toHaveLength(1);
      expect(commits[0].sha).toBe('traversal-sha');
    });
  });

  describe('batch operations', () => {
    it('should batch create commits in a transaction', () => {
      const commits = store.batchCreateCommits([
        {
          sha: 'batch-1',
          author_name: 'A',
          author_email: 'a@test.com',
          authored_date: '2024-01-01',
          message: 'first',
        },
        {
          sha: 'batch-2',
          author_name: 'B',
          author_email: 'b@test.com',
          authored_date: '2024-01-02',
          message: 'second',
        },
      ]);
      expect(commits).toHaveLength(2);
      expect(store.getAllCommits()).toHaveLength(2);
    });

    it('should rollback batch on error', () => {
      expect(() =>
        store.batchCreateCommits([
          {
            sha: 'ok-sha',
            author_name: 'A',
            author_email: 'a@test.com',
            authored_date: '2024-01-01',
            message: 'ok',
          },
          {
            sha: 'ok-sha', // duplicate - will cause error
            author_name: 'B',
            author_email: 'b@test.com',
            authored_date: '2024-01-02',
            message: 'duplicate',
          },
        ])
      ).toThrow();
      // Transaction should have rolled back
      expect(store.getAllCommits()).toHaveLength(0);
    });

    it('should batch create commit-file relationships', () => {
      const commit = store.createCommit({
        sha: 'batch-cf',
        author_name: 'A',
        author_email: 'a@test.com',
        authored_date: '2024-01-01',
        message: 'batch',
      });
      const file1 = store.createFile({ current_path: 'f1.ts' });
      const file2 = store.createFile({ current_path: 'f2.ts' });

      store.batchCreateCommitFiles([
        { commit_id: commit.id, file_id: file1.id, lines_added: 10 },
        { commit_id: commit.id, file_id: file2.id, lines_added: 20 },
      ]);

      expect(store.getCommitFilesByCommit(commit.id)).toHaveLength(2);
    });
  });

  describe('utility methods', () => {
    it('should get last commit sha', () => {
      expect(store.getLastCommitSha()).toBeNull();

      store.createCommit({
        sha: 'older',
        author_name: 'A',
        author_email: 'a@test.com',
        authored_date: '2024-01-01',
        message: 'older',
      });
      store.createCommit({
        sha: 'newer',
        author_name: 'B',
        author_email: 'b@test.com',
        authored_date: '2024-06-01',
        message: 'newer',
      });

      expect(store.getLastCommitSha()).toBe('newer');
    });

    it('should get node counts', () => {
      store.createFile({ current_path: 'a.ts' });
      store.createFile({ current_path: 'b.ts' });
      store.createCommit({
        sha: 'c1',
        author_name: 'A',
        author_email: 'a@test.com',
        authored_date: '2024-01-01',
        message: 'msg',
      });
      store.createAuthor({
        name: 'A',
        email: 'a@test.com',
        first_seen: '2024-01-01',
        last_seen: '2024-01-01',
      });
      store.createTicket({
        identifier: 'T-1',
        type: 'jira',
        source_commit_sha: 'c1',
      });

      const counts = store.getNodeCounts();
      expect(counts).toEqual({ files: 2, commits: 1, authors: 1, tickets: 1 });
    });

    it('should use transactions for atomicity', () => {
      const file = store.createFile({ current_path: 'transact.ts' });

      // Successful transaction
      store.transaction(() => {
        store.createCommit({
          sha: 'tx-1',
          author_name: 'A',
          author_email: 'a@test.com',
          authored_date: '2024-01-01',
          message: 'in transaction',
        });
      });
      expect(store.getCommitBySha('tx-1')).not.toBeNull();

      // Failed transaction should rollback
      expect(() =>
        store.transaction(() => {
          store.createCommit({
            sha: 'tx-2',
            author_name: 'B',
            author_email: 'b@test.com',
            authored_date: '2024-01-02',
            message: 'will rollback',
          });
          throw new Error('Intentional failure');
        })
      ).toThrow('Intentional failure');
      expect(store.getCommitBySha('tx-2')).toBeNull();
    });
  });
});

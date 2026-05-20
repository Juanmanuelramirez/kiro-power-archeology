import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// === Entity Types for the Store ===

export interface FileRecord {
  id: number;
  current_path: string;
  previous_paths: string[];
  first_commit_sha: string | null;
  created_at: string;
}

export interface CommitRecord {
  id: number;
  sha: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  message: string;
  lines_added: number;
  lines_deleted: number;
}

export interface AuthorRecord {
  id: number;
  name: string;
  email: string;
  total_commits: number;
  first_seen: string;
  last_seen: string;
}

export interface TicketRecord {
  id: number;
  identifier: string;
  type: string;
  source_commit_sha: string;
}

export interface CommitFileRecord {
  commit_id: number;
  file_id: number;
  lines_added: number;
  lines_deleted: number;
  change_ratio: number;
}

export interface CommitTicketRecord {
  commit_id: number;
  ticket_id: number;
}

export interface FileRenameRecord {
  id: number;
  file_id: number;
  old_path: string;
  new_path: string;
  commit_sha: string;
  renamed_at: string;
}

export interface LogicalCouplingRecord {
  file_a_id: number;
  file_b_id: number;
  shared_commits: number;
  co_occurrence_ratio: number;
  last_calculated: string;
}

// === Input types (without auto-generated fields) ===

export interface CreateFileInput {
  current_path: string;
  previous_paths?: string[];
  first_commit_sha?: string | null;
}

export interface CreateCommitInput {
  sha: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  message: string;
  lines_added?: number;
  lines_deleted?: number;
}

export interface CreateAuthorInput {
  name: string;
  email: string;
  total_commits?: number;
  first_seen: string;
  last_seen: string;
}

export interface CreateTicketInput {
  identifier: string;
  type: string;
  source_commit_sha: string;
}

export interface CreateCommitFileInput {
  commit_id: number;
  file_id: number;
  lines_added?: number;
  lines_deleted?: number;
  change_ratio?: number;
}

export interface CreateFileRenameInput {
  file_id: number;
  old_path: string;
  new_path: string;
  commit_sha: string;
  renamed_at: string;
}

export interface CreateLogicalCouplingInput {
  file_a_id: number;
  file_b_id: number;
  shared_commits: number;
  co_occurrence_ratio: number;
}

/**
 * SQLite-backed storage layer for the Archeology Knowledge Graph.
 * Manages all persistence and query operations for files, commits, authors,
 * tickets, and their relationships.
 */
export class SqliteStore {
  private db: Database.Database;

  /**
   * Creates a new SqliteStore instance.
   * @param dbPath - Path to the SQLite database file, or ':memory:' for in-memory database
   */
  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.runMigrations();
  }

  // === Migration Runner ===

  /**
   * Runs all pending migrations in order.
   * Migrations are SQL files in the migrations/ directory named with a numeric prefix.
   */
  private runMigrations(): void {
    // Ensure schema_migrations table exists first
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
    const migrationFiles = this.getMigrationFiles(migrationsDir);

    const appliedVersions = new Set(
      this.db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((row: any) => row.version as number)
    );

    for (const { version, name, filePath } of migrationFiles) {
      if (appliedVersions.has(version)) {
        continue;
      }

      const sql = readFileSync(filePath, 'utf-8');
      this.db.exec(sql);
      this.db
        .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(version, name);
    }
  }

  private getMigrationFiles(dir: string): Array<{ version: number; name: string; filePath: string }> {
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      return [];
    }

    return files
      .filter((f) => f.endsWith('.sql'))
      .map((f) => {
        const match = f.match(/^(\d+)-(.+)\.sql$/);
        if (!match) return null;
        return {
          version: parseInt(match[1], 10),
          name: match[2],
          filePath: join(dir, f),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.version - b.version);
  }

  // === File CRUD ===

  createFile(input: CreateFileInput): FileRecord {
    const stmt = this.db.prepare(`
      INSERT INTO files (current_path, previous_paths, first_commit_sha)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(
      input.current_path,
      JSON.stringify(input.previous_paths ?? []),
      input.first_commit_sha ?? null
    );
    return this.getFileById(result.lastInsertRowid as number)!;
  }

  getFileById(id: number): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
    return row ? this.mapFileRow(row) : null;
  }

  getFileByPath(path: string): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE current_path = ?').get(path) as any;
    return row ? this.mapFileRow(row) : null;
  }

  updateFilePath(id: number, newPath: string, previousPaths: string[]): void {
    this.db
      .prepare('UPDATE files SET current_path = ?, previous_paths = ? WHERE id = ?')
      .run(newPath, JSON.stringify(previousPaths), id);
  }

  getAllFiles(): FileRecord[] {
    const rows = this.db.prepare('SELECT * FROM files').all() as any[];
    return rows.map((row) => this.mapFileRow(row));
  }

  deleteFile(id: number): void {
    this.db.prepare('DELETE FROM files WHERE id = ?').run(id);
  }

  private mapFileRow(row: any): FileRecord {
    return {
      id: row.id,
      current_path: row.current_path,
      previous_paths: JSON.parse(row.previous_paths),
      first_commit_sha: row.first_commit_sha,
      created_at: row.created_at,
    };
  }

  // === Commit CRUD ===

  createCommit(input: CreateCommitInput): CommitRecord {
    const stmt = this.db.prepare(`
      INSERT INTO commits (sha, author_name, author_email, authored_date, message, lines_added, lines_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.sha,
      input.author_name,
      input.author_email,
      input.authored_date,
      input.message,
      input.lines_added ?? 0,
      input.lines_deleted ?? 0
    );
    return this.getCommitById(result.lastInsertRowid as number)!;
  }

  getCommitById(id: number): CommitRecord | null {
    const row = this.db.prepare('SELECT * FROM commits WHERE id = ?').get(id) as any;
    return row ?? null;
  }

  getCommitBySha(sha: string): CommitRecord | null {
    const row = this.db.prepare('SELECT * FROM commits WHERE sha = ?').get(sha) as any;
    return row ?? null;
  }

  getAllCommits(): CommitRecord[] {
    return this.db.prepare('SELECT * FROM commits').all() as CommitRecord[];
  }

  deleteCommit(id: number): void {
    this.db.prepare('DELETE FROM commits WHERE id = ?').run(id);
  }

  // === Author CRUD ===

  createAuthor(input: CreateAuthorInput): AuthorRecord {
    const stmt = this.db.prepare(`
      INSERT INTO authors (name, email, total_commits, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.name,
      input.email,
      input.total_commits ?? 0,
      input.first_seen,
      input.last_seen
    );
    return this.getAuthorById(result.lastInsertRowid as number)!;
  }

  getAuthorById(id: number): AuthorRecord | null {
    const row = this.db.prepare('SELECT * FROM authors WHERE id = ?').get(id) as any;
    return row ?? null;
  }

  getAuthorByEmail(email: string): AuthorRecord | null {
    const row = this.db.prepare('SELECT * FROM authors WHERE email = ?').get(email) as any;
    return row ?? null;
  }

  updateAuthor(id: number, updates: Partial<Pick<AuthorRecord, 'name' | 'total_commits' | 'last_seen'>>): void {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.total_commits !== undefined) {
      setClauses.push('total_commits = ?');
      values.push(updates.total_commits);
    }
    if (updates.last_seen !== undefined) {
      setClauses.push('last_seen = ?');
      values.push(updates.last_seen);
    }

    if (setClauses.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE authors SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  getAllAuthors(): AuthorRecord[] {
    return this.db.prepare('SELECT * FROM authors').all() as AuthorRecord[];
  }

  deleteAuthor(id: number): void {
    this.db.prepare('DELETE FROM authors WHERE id = ?').run(id);
  }

  // === Ticket CRUD ===

  createTicket(input: CreateTicketInput): TicketRecord {
    const stmt = this.db.prepare(`
      INSERT INTO tickets (identifier, type, source_commit_sha)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(input.identifier, input.type, input.source_commit_sha);
    return this.getTicketById(result.lastInsertRowid as number)!;
  }

  getTicketById(id: number): TicketRecord | null {
    const row = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    return row ?? null;
  }

  getTicketByIdentifier(identifier: string): TicketRecord | null {
    const row = this.db.prepare('SELECT * FROM tickets WHERE identifier = ?').get(identifier) as any;
    return row ?? null;
  }

  getAllTickets(): TicketRecord[] {
    return this.db.prepare('SELECT * FROM tickets').all() as TicketRecord[];
  }

  deleteTicket(id: number): void {
    this.db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
  }

  // === Commit-File Relationships ===

  createCommitFile(input: CreateCommitFileInput): void {
    this.db
      .prepare(`
        INSERT INTO commit_files (commit_id, file_id, lines_added, lines_deleted, change_ratio)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        input.commit_id,
        input.file_id,
        input.lines_added ?? 0,
        input.lines_deleted ?? 0,
        input.change_ratio ?? 0.0
      );
  }

  getCommitFilesByCommit(commitId: number): CommitFileRecord[] {
    return this.db
      .prepare('SELECT * FROM commit_files WHERE commit_id = ?')
      .all(commitId) as CommitFileRecord[];
  }

  getCommitFilesByFile(fileId: number): CommitFileRecord[] {
    return this.db
      .prepare('SELECT * FROM commit_files WHERE file_id = ?')
      .all(fileId) as CommitFileRecord[];
  }

  // === Commit-Ticket Relationships ===

  createCommitTicket(commitId: number, ticketId: number): void {
    this.db
      .prepare('INSERT INTO commit_tickets (commit_id, ticket_id) VALUES (?, ?)')
      .run(commitId, ticketId);
  }

  getCommitTicketsByCommit(commitId: number): CommitTicketRecord[] {
    return this.db
      .prepare('SELECT * FROM commit_tickets WHERE commit_id = ?')
      .all(commitId) as CommitTicketRecord[];
  }

  getCommitTicketsByTicket(ticketId: number): CommitTicketRecord[] {
    return this.db
      .prepare('SELECT * FROM commit_tickets WHERE ticket_id = ?')
      .all(ticketId) as CommitTicketRecord[];
  }

  // === File Renames ===

  createFileRename(input: CreateFileRenameInput): FileRenameRecord {
    const stmt = this.db.prepare(`
      INSERT INTO file_renames (file_id, old_path, new_path, commit_sha, renamed_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.file_id,
      input.old_path,
      input.new_path,
      input.commit_sha,
      input.renamed_at
    );
    return this.db
      .prepare('SELECT * FROM file_renames WHERE id = ?')
      .get(result.lastInsertRowid) as FileRenameRecord;
  }

  getFileRenamesByFile(fileId: number): FileRenameRecord[] {
    return this.db
      .prepare('SELECT * FROM file_renames WHERE file_id = ? ORDER BY renamed_at ASC')
      .all(fileId) as FileRenameRecord[];
  }

  // === Logical Couplings ===

  upsertLogicalCoupling(input: CreateLogicalCouplingInput): void {
    this.db
      .prepare(`
        INSERT INTO logical_couplings (file_a_id, file_b_id, shared_commits, co_occurrence_ratio, last_calculated)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT (file_a_id, file_b_id) DO UPDATE SET
          shared_commits = excluded.shared_commits,
          co_occurrence_ratio = excluded.co_occurrence_ratio,
          last_calculated = datetime('now')
      `)
      .run(input.file_a_id, input.file_b_id, input.shared_commits, input.co_occurrence_ratio);
  }

  getLogicalCouplingsByFile(fileId: number): LogicalCouplingRecord[] {
    return this.db
      .prepare(`
        SELECT * FROM logical_couplings
        WHERE file_a_id = ? OR file_b_id = ?
        ORDER BY co_occurrence_ratio DESC
      `)
      .all(fileId, fileId) as LogicalCouplingRecord[];
  }

  // === Graph Traversal Queries ===

  /**
   * Get all files modified in a specific commit.
   */
  getFilesByCommit(commitId: number): FileRecord[] {
    const rows = this.db
      .prepare(`
        SELECT f.* FROM files f
        INNER JOIN commit_files cf ON cf.file_id = f.id
        WHERE cf.commit_id = ?
      `)
      .all(commitId) as any[];
    return rows.map((row) => this.mapFileRow(row));
  }

  /**
   * Get all commits that modified a specific file.
   */
  getCommitsByFile(fileId: number): CommitRecord[] {
    return this.db
      .prepare(`
        SELECT c.* FROM commits c
        INNER JOIN commit_files cf ON cf.commit_id = c.id
        WHERE cf.file_id = ?
        ORDER BY c.authored_date DESC
      `)
      .all(fileId) as CommitRecord[];
  }

  /**
   * Get all tickets referenced by a specific commit.
   */
  getTicketsByCommit(commitId: number): TicketRecord[] {
    return this.db
      .prepare(`
        SELECT t.* FROM tickets t
        INNER JOIN commit_tickets ct ON ct.ticket_id = t.id
        WHERE ct.commit_id = ?
      `)
      .all(commitId) as TicketRecord[];
  }

  /**
   * Get all commits that reference a specific ticket.
   */
  getCommitsByTicket(ticketId: number): CommitRecord[] {
    return this.db
      .prepare(`
        SELECT c.* FROM commits c
        INNER JOIN commit_tickets ct ON ct.commit_id = c.id
        WHERE ct.ticket_id = ?
        ORDER BY c.authored_date DESC
      `)
      .all(ticketId) as CommitRecord[];
  }

  /**
   * Get the author of a specific commit.
   */
  getAuthorByCommit(commitId: number): AuthorRecord | null {
    const commit = this.getCommitById(commitId);
    if (!commit) return null;
    return this.getAuthorByEmail(commit.author_email);
  }

  /**
   * Get all commits by a specific author.
   */
  getCommitsByAuthor(authorEmail: string): CommitRecord[] {
    return this.db
      .prepare('SELECT * FROM commits WHERE author_email = ? ORDER BY authored_date DESC')
      .all(authorEmail) as CommitRecord[];
  }

  /**
   * Get the last known commit SHA in the database (most recent by authored_date).
   */
  getLastCommitSha(): string | null {
    const row = this.db
      .prepare('SELECT sha FROM commits ORDER BY authored_date DESC LIMIT 1')
      .get() as any;
    return row?.sha ?? null;
  }

  /**
   * Get total node counts for graph status reporting.
   */
  getNodeCounts(): { files: number; commits: number; authors: number; tickets: number } {
    const files = (this.db.prepare('SELECT COUNT(*) as count FROM files').get() as any).count;
    const commits = (this.db.prepare('SELECT COUNT(*) as count FROM commits').get() as any).count;
    const authors = (this.db.prepare('SELECT COUNT(*) as count FROM authors').get() as any).count;
    const tickets = (this.db.prepare('SELECT COUNT(*) as count FROM tickets').get() as any).count;
    return { files, commits, authors, tickets };
  }

  // === Batch Operations with Transactions ===

  /**
   * Execute a function within a transaction. Rolls back on error.
   */
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Insert multiple commits in a single transaction.
   */
  batchCreateCommits(inputs: CreateCommitInput[]): CommitRecord[] {
    return this.transaction(() => {
      return inputs.map((input) => this.createCommit(input));
    });
  }

  /**
   * Insert multiple commit-file relationships in a single transaction.
   */
  batchCreateCommitFiles(inputs: CreateCommitFileInput[]): void {
    this.transaction(() => {
      for (const input of inputs) {
        this.createCommitFile(input);
      }
    });
  }

  // === Schema Info ===

  /**
   * Get the current schema version.
   */
  getSchemaVersion(): number {
    try {
      const row = this.db
        .prepare('SELECT MAX(version) as version FROM schema_migrations')
        .get() as any;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  // === Lifecycle ===

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

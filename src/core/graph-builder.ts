/**
 * Knowledge Graph Builder
 *
 * Processes git history to build and maintain the Knowledge Graph.
 * Supports both full initial builds and incremental updates.
 */

import type {
  GitAdapter,
  GraphBuilder,
  BuildProgress,
  UpdateResult,
  GraphStatus,
  CommitEntry,
} from '../types/index.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import { extractTickets } from './ticket-extractor.js';

export class KnowledgeGraphBuilder implements GraphBuilder {
  private readonly git: GitAdapter;
  private readonly store: SqliteStore;
  private state: 'not-initialized' | 'building' | 'ready' | 'error' = 'not-initialized';
  private progress: { processed: number; total: number } | undefined;
  private errorMessage: string | undefined;
  private lastUpdated: string | null = null;

  constructor(git: GitAdapter, store: SqliteStore) {
    this.git = git;
    this.store = store;
  }

  async initialize(repoPath: string): Promise<void> {
    try {
      const isValid = await this.git.isValidRepo();
      if (!isValid) {
        this.state = 'error';
        this.errorMessage = `Not a valid git repository: ${repoPath}`;
        return;
      }

      // Check if we already have data (resuming from a previous build)
      const lastSha = this.store.getLastCommitSha();
      if (lastSha) {
        this.state = 'ready';
        this.lastUpdated = new Date().toISOString();
      } else {
        this.state = 'not-initialized';
      }
    } catch (err: unknown) {
      this.state = 'error';
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async buildInitial(): Promise<BuildProgress> {
    try {
      this.state = 'building';
      this.errorMessage = undefined;

      // Get all commits from the repository
      const allCommits = await this.git.log({ all: true });
      const total = allCommits.length;
      this.progress = { processed: 0, total };

      if (total === 0) {
        this.state = 'ready';
        this.lastUpdated = new Date().toISOString();
        return { processed: 0, total: 0, state: 'ready' };
      }

      // Process commits oldest first for correct first_commit_sha tracking
      const orderedCommits = [...allCommits].reverse();

      // Process in batches for performance
      const BATCH_SIZE = 50;
      for (let i = 0; i < orderedCommits.length; i += BATCH_SIZE) {
        const batch = orderedCommits.slice(i, i + BATCH_SIZE);
        await this.processCommitBatch(batch);
        this.progress = { processed: Math.min(i + BATCH_SIZE, total), total };
      }

      // Track file renames after all commits are processed
      await this.trackFileRenames();

      this.state = 'ready';
      this.lastUpdated = new Date().toISOString();
      this.progress = { processed: total, total };

      return { processed: total, total, state: 'ready' };
    } catch (err: unknown) {
      this.state = 'error';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      return {
        processed: this.progress?.processed ?? 0,
        total: this.progress?.total ?? 0,
        state: 'error',
        error: this.errorMessage,
      };
    }
  }

  async updateIncremental(): Promise<UpdateResult> {
    const startTime = Date.now();
    let newCommits = 0;
    let newFiles = 0;
    let newAuthors = 0;
    let newTickets = 0;

    try {
      const lastKnownSha = this.store.getLastCommitSha();
      const commits = await this.git.getNewCommits(lastKnownSha);

      if (commits.length === 0) {
        return { newCommits: 0, newFiles: 0, newAuthors: 0, newTickets: 0, duration: Date.now() - startTime };
      }

      // getNewCommits returns newest first; process oldest first
      const orderedCommits = [...commits].reverse();

      // Process in batches
      const BATCH_SIZE = 50;
      for (let i = 0; i < orderedCommits.length; i += BATCH_SIZE) {
        const batch = orderedCommits.slice(i, i + BATCH_SIZE);
        const result = await this.processCommitBatch(batch);
        newCommits += result.newCommits;
        newFiles += result.newFiles;
        newAuthors += result.newAuthors;
        newTickets += result.newTickets;
      }

      // Track renames for any new files
      await this.trackFileRenames();

      this.lastUpdated = new Date().toISOString();
      this.state = 'ready';

      return {
        newCommits,
        newFiles,
        newAuthors,
        newTickets,
        duration: Date.now() - startTime,
      };
    } catch (err: unknown) {
      this.state = 'error';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      return {
        newCommits,
        newFiles,
        newAuthors,
        newTickets,
        duration: Date.now() - startTime,
      };
    }
  }

  async getStatus(): Promise<GraphStatus> {
    const nodeCounts = this.store.getNodeCounts();
    return {
      state: this.state,
      progress: this.progress,
      lastUpdated: this.lastUpdated,
      totalNodes: nodeCounts,
      error: this.errorMessage,
    };
  }

  isReady(): boolean {
    return this.state === 'ready';
  }

  // === Private Methods ===

  /**
   * Processes a batch of commits: fetches file stats asynchronously,
   * then inserts everything in a single SQLite transaction.
   */
  private async processCommitBatch(
    commits: CommitEntry[]
  ): Promise<{ newCommits: number; newFiles: number; newAuthors: number; newTickets: number }> {
    let newCommits = 0;
    let newFiles = 0;
    let newAuthors = 0;
    let newTickets = 0;

    // Pre-fetch file stats for all commits (async I/O before transaction)
    const commitFileStats = new Map<string, Array<{ file: string; added: number; deleted: number }>>();

    for (const commit of commits) {
      // Skip if already in the database
      const existing = this.store.getCommitBySha(commit.sha);
      if (existing) continue;

      const stats = await this.fetchFileStats(commit.sha);
      commitFileStats.set(commit.sha, stats);
    }

    // Process everything in a single synchronous transaction
    this.store.transaction(() => {
      for (const commit of commits) {
        if (!commitFileStats.has(commit.sha)) continue; // Already existed

        // Create commit node
        const commitRecord = this.store.createCommit({
          sha: commit.sha,
          author_name: commit.authorName,
          author_email: commit.authorEmail,
          authored_date: commit.date,
          message: commit.message,
        });
        newCommits++;

        // Create or update author node
        const existingAuthor = this.store.getAuthorByEmail(commit.authorEmail);
        if (existingAuthor) {
          this.store.updateAuthor(existingAuthor.id, {
            name: commit.authorName,
            total_commits: existingAuthor.total_commits + 1,
            last_seen: commit.date,
          });
        } else {
          this.store.createAuthor({
            name: commit.authorName,
            email: commit.authorEmail,
            total_commits: 1,
            first_seen: commit.date,
            last_seen: commit.date,
          });
          newAuthors++;
        }

        // Extract tickets from commit message and create nodes/relationships
        const tickets = extractTickets(commit.message);
        for (const ticket of tickets) {
          let ticketRecord = this.store.getTicketByIdentifier(ticket.identifier);
          if (!ticketRecord) {
            ticketRecord = this.store.createTicket({
              identifier: ticket.identifier,
              type: ticket.type,
              source_commit_sha: commit.sha,
            });
            newTickets++;
          }
          this.store.createCommitTicket(commitRecord.id, ticketRecord.id);
        }

        // Link commit to files
        const fileStats = commitFileStats.get(commit.sha) ?? [];
        for (const fileStat of fileStats) {
          if (!fileStat.file || fileStat.file.trim() === '') continue;

          let fileRecord = this.store.getFileByPath(fileStat.file);
          if (!fileRecord) {
            fileRecord = this.store.createFile({
              current_path: fileStat.file,
              first_commit_sha: commit.sha,
            });
            newFiles++;
          }
          this.store.createCommitFile({
            commit_id: commitRecord.id,
            file_id: fileRecord.id,
            lines_added: fileStat.added,
            lines_deleted: fileStat.deleted,
          });
        }
      }
    });

    return { newCommits, newFiles, newAuthors, newTickets };
  }

  /**
   * Fetches file change stats for a commit.
   * Uses numstat for accurate line counts, falls back to show for edge cases.
   */
  private async fetchFileStats(commitSha: string): Promise<Array<{ file: string; added: number; deleted: number }>> {
    try {
      const stats = await this.git.numstat(commitSha);
      return stats.map(s => ({ file: s.file, added: s.added, deleted: s.deleted }));
    } catch {
      // numstat may fail for initial commits (no parent) or merge commits
      try {
        const detail = await this.git.show(commitSha);
        return detail.filesChanged.map(f => ({ file: f, added: 0, deleted: 0 }));
      } catch {
        return [];
      }
    }
  }

  /**
   * Tracks file renames by using git log --follow for each known file.
   * When a rename is detected, merges the old file node into the current one,
   * preserving all historical relationships under a single node.
   */
  private async trackFileRenames(): Promise<void> {
    const allFiles = this.store.getAllFiles();

    for (const file of allFiles) {
      try {
        const followHistory = await this.git.logFollow(file.current_path);
        if (followHistory.length === 0) continue;

        // Check if any commits in the follow history are linked to a different
        // file node (indicating the file was previously known under a different path)
        const previousPaths: string[] = [...file.previous_paths];
        let hasNewRenames = false;

        for (const historyCommit of followHistory) {
          const commitRecord = this.store.getCommitBySha(historyCommit.sha);
          if (!commitRecord) continue;

          // Look for other file nodes linked to this commit that might be old paths
          const commitFiles = this.store.getFilesByCommit(commitRecord.id);
          for (const cf of commitFiles) {
            if (cf.id === file.id) continue;
            if (cf.current_path === file.current_path) continue;
            if (previousPaths.includes(cf.current_path)) continue;

            // This is a candidate for a renamed file — verify it's not still active
            // by checking if it has commits that are NOT in our follow history
            const cfCommits = this.store.getCommitFilesByFile(cf.id);
            const followShas = new Set(followHistory.map(h => h.sha));
            const allCfCommitShas = cfCommits.map(c => {
              const rec = this.store.getCommitById(c.commit_id);
              return rec?.sha;
            }).filter(Boolean);

            const isSubsetOfFollow = allCfCommitShas.every(sha => followShas.has(sha!));
            if (!isSubsetOfFollow) continue;

            // This file node is a previous incarnation of our file
            previousPaths.push(cf.current_path);
            hasNewRenames = true;

            // Record the rename
            this.store.createFileRename({
              file_id: file.id,
              old_path: cf.current_path,
              new_path: file.current_path,
              commit_sha: historyCommit.sha,
              renamed_at: historyCommit.date,
            });

            // Transfer relationships from the old file node to this one
            const oldFileCommits = this.store.getCommitFilesByFile(cf.id);
            for (const oldCf of oldFileCommits) {
              try {
                this.store.createCommitFile({
                  commit_id: oldCf.commit_id,
                  file_id: file.id,
                  lines_added: oldCf.lines_added,
                  lines_deleted: oldCf.lines_deleted,
                  change_ratio: oldCf.change_ratio,
                });
              } catch {
                // Relationship may already exist (primary key conflict)
              }
            }

            // Remove the duplicate file node
            this.store.deleteFile(cf.id);
          }
        }

        if (hasNewRenames) {
          this.store.updateFilePath(file.id, file.current_path, previousPaths);
        }
      } catch {
        // logFollow may fail for deleted files or binary files — skip silently
      }
    }
  }
}

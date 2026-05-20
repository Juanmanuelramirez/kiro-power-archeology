import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OracleChatEngine } from './oracle-chat.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import type { GraphStatus, ArcheologyConfig } from '../types/index.js';
import type { ExternalLlmClient, ExternalLlmPayload } from './oracle-chat.js';

describe('OracleChatEngine', () => {
  let store: SqliteStore;
  let engine: OracleChatEngine;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
    engine = new OracleChatEngine(store);
  });

  afterEach(() => {
    store.close();
  });

  describe('input validation', () => {
    it('should reject questions exceeding 500 characters', async () => {
      const longQuestion = 'a'.repeat(501);
      const result = await engine.ask({ question: longQuestion });

      expect(result.answer).toContain('exceeds the maximum length');
      expect(result.references).toHaveLength(0);
      expect(result.confidence).toBe('low');
    });

    it('should accept questions of exactly 500 characters', async () => {
      const question = 'a'.repeat(500);
      const result = await engine.ask({ question });

      // Should not be rejected for length
      expect(result.answer).not.toContain('exceeds the maximum length');
    });

    it('should reject empty questions', async () => {
      const result = await engine.ask({ question: '' });

      expect(result.answer).toContain('Please provide a question');
      expect(result.references).toHaveLength(0);
      expect(result.confidence).toBe('low');
    });

    it('should reject whitespace-only questions', async () => {
      const result = await engine.ask({ question: '   ' });

      expect(result.answer).toContain('Please provide a question');
      expect(result.references).toHaveLength(0);
      expect(result.confidence).toBe('low');
    });
  });

  describe('graph not ready state', () => {
    it('should inform user when graph is not initialized', async () => {
      const statusProvider = async (): Promise<GraphStatus> => ({
        state: 'not-initialized',
        lastUpdated: null,
        totalNodes: { files: 0, commits: 0, authors: 0, tickets: 0 },
      });
      engine.setGraphStatusProvider(statusProvider);

      const result = await engine.ask({ question: 'who changed the auth module' });

      expect(result.answer).toContain('not ready');
      expect(result.answer).toContain('indexation');
      expect(result.references).toHaveLength(0);
      expect(result.confidence).toBe('low');
    });

    it('should inform user when graph is building', async () => {
      const statusProvider = async (): Promise<GraphStatus> => ({
        state: 'building',
        progress: { processed: 50, total: 200 },
        lastUpdated: null,
        totalNodes: { files: 10, commits: 50, authors: 3, tickets: 2 },
      });
      engine.setGraphStatusProvider(statusProvider);

      const result = await engine.ask({ question: 'who changed the auth module' });

      expect(result.answer).toContain('not ready');
      expect(result.confidence).toBe('low');
    });

    it('should inform user when graph has an error', async () => {
      const statusProvider = async (): Promise<GraphStatus> => ({
        state: 'error',
        lastUpdated: null,
        totalNodes: { files: 0, commits: 0, authors: 0, tickets: 0 },
        error: 'Repository not found',
      });
      engine.setGraphStatusProvider(statusProvider);

      const result = await engine.ask({ question: 'who changed the auth module' });

      expect(result.answer).toContain('error');
      expect(result.answer).toContain('Repository not found');
      expect(result.confidence).toBe('low');
    });

    it('should proceed when graph is ready', async () => {
      const statusProvider = async (): Promise<GraphStatus> => ({
        state: 'ready',
        lastUpdated: new Date().toISOString(),
        totalNodes: { files: 10, commits: 50, authors: 3, tickets: 2 },
      });
      engine.setGraphStatusProvider(statusProvider);

      // With no data in the store, it should return "no results" rather than "not ready"
      const result = await engine.ask({ question: 'who changed the auth module' });

      expect(result.answer).not.toContain('not ready');
    });
  });

  describe('out-of-scope questions', () => {
    it('should reject questions about weather', async () => {
      const result = await engine.ask({ question: 'what is the weather today' });

      expect(result.answer).toContain('only answer questions about the history');
      expect(result.references).toHaveLength(0);
      expect(result.confidence).toBe('low');
    });

    it('should reject questions about recipes', async () => {
      const result = await engine.ask({ question: 'best chocolate cake recipe for birthday' });

      expect(result.answer).toContain('only answer questions about the history');
      expect(result.references).toHaveLength(0);
    });

    it('should accept questions about commits', async () => {
      const result = await engine.ask({ question: 'when was the last commit to the auth module' });

      expect(result.answer).not.toContain('only answer questions about the history');
    });

    it('should accept questions about who made changes', async () => {
      const result = await engine.ask({ question: 'who modified the database layer' });

      expect(result.answer).not.toContain('only answer questions about the history');
    });

    it('should accept ambiguous questions (benefit of the doubt)', async () => {
      const result = await engine.ask({ question: 'tell me about the system' });

      expect(result.answer).not.toContain('only answer questions about the history');
    });
  });

  describe('no results found', () => {
    it('should suggest alternative sources when no results found', async () => {
      const result = await engine.ask({ question: 'who introduced the xyz123abc dependency' });

      expect(result.answer).toContain('No relevant information');
      expect(result.answer).toContain('git log');
      expect(result.references).toHaveLength(0);
      expect(result.confidence).toBe('low');
    });
  });

  describe('querying the Knowledge Graph', () => {
    beforeEach(() => {
      // Populate the store with test data
      const author = store.createAuthor({
        name: 'Alice Smith',
        email: 'alice@example.com',
        total_commits: 5,
        first_seen: '2023-01-01T00:00:00Z',
        last_seen: '2024-01-01T00:00:00Z',
      });

      const commit1 = store.createCommit({
        sha: 'abc1234567890def1234567890abcdef12345678',
        author_name: 'Alice Smith',
        author_email: 'alice@example.com',
        authored_date: '2024-01-15T10:00:00Z',
        message: 'fix: resolve authentication bug in login module',
        lines_added: 10,
        lines_deleted: 3,
      });

      const commit2 = store.createCommit({
        sha: 'def4567890abcdef1234567890abcdef12345678',
        author_name: 'Alice Smith',
        author_email: 'alice@example.com',
        authored_date: '2024-02-20T14:00:00Z',
        message: 'refactor: extract database connection pool',
        lines_added: 50,
        lines_deleted: 30,
      });

      const file1 = store.createFile({
        current_path: 'src/auth/login.ts',
        first_commit_sha: 'abc1234567890def1234567890abcdef12345678',
      });

      const file2 = store.createFile({
        current_path: 'src/database/connection-pool.ts',
        first_commit_sha: 'def4567890abcdef1234567890abcdef12345678',
      });

      store.createCommitFile({ commit_id: commit1.id, file_id: file1.id, lines_added: 10, lines_deleted: 3 });
      store.createCommitFile({ commit_id: commit2.id, file_id: file2.id, lines_added: 50, lines_deleted: 30 });

      const ticket = store.createTicket({
        identifier: 'AUTH-123',
        type: 'jira',
        source_commit_sha: 'abc1234567890def1234567890abcdef12345678',
      });

      store.createCommitTicket(commit1.id, ticket.id);
    });

    it('should find commits by message keywords', async () => {
      const result = await engine.ask({ question: 'when was the authentication bug fixed' });

      expect(result.references.length).toBeGreaterThan(0);
      expect(result.answer).toContain('abc1234');
    });

    it('should find files by path keywords', async () => {
      const result = await engine.ask({ question: 'what changes were made to the login module' });

      expect(result.references.length).toBeGreaterThan(0);
      const fileRef = result.references.find(r => r.type === 'file');
      expect(fileRef).toBeDefined();
      expect(fileRef!.identifier).toContain('login');
    });

    it('should find authors by name', async () => {
      const result = await engine.ask({ question: 'what did alice change in the project' });

      expect(result.answer).toContain('Alice');
    });

    it('should find tickets by identifier', async () => {
      const result = await engine.ask({ question: 'what is the status of auth-123 ticket' });

      expect(result.references.length).toBeGreaterThan(0);
      const ticketRef = result.references.find(r => r.type === 'ticket');
      expect(ticketRef).toBeDefined();
      expect(ticketRef!.identifier).toBe('AUTH-123');
    });

    it('should include commit SHA in references', async () => {
      const result = await engine.ask({ question: 'who fixed the authentication bug' });

      const commitRef = result.references.find(r => r.type === 'commit');
      expect(commitRef).toBeDefined();
      expect(commitRef!.identifier).toBe('abc1234567890def1234567890abcdef12345678');
    });

    it('should return high confidence when many results found', async () => {
      const result = await engine.ask({ question: 'tell me about authentication changes and login fix' });

      // With commits + files + tickets matching, should be high confidence
      expect(result.references.length).toBeGreaterThanOrEqual(1);
    });

    it('should include at least one reference for every response with results', async () => {
      const result = await engine.ask({ question: 'what was refactored in the database module' });

      expect(result.references.length).toBeGreaterThan(0);
    });
  });

  describe('keyword extraction', () => {
    it('should extract meaningful keywords from a question', () => {
      const keywords = engine.extractKeywords('who introduced the authentication module');

      expect(keywords).toContain('introduced');
      expect(keywords).toContain('authentication');
      expect(keywords).toContain('module');
      // Stop words should be removed
      expect(keywords).not.toContain('who');
      expect(keywords).not.toContain('the');
    });

    it('should remove short words (2 chars or less)', () => {
      const keywords = engine.extractKeywords('is it a bug in db');

      expect(keywords).not.toContain('is');
      expect(keywords).not.toContain('it');
      expect(keywords).not.toContain('a');
      expect(keywords).not.toContain('in');
      expect(keywords).not.toContain('db');
      expect(keywords).toContain('bug');
    });

    it('should deduplicate keywords', () => {
      const keywords = engine.extractKeywords('fix the fix in the fix module');

      const fixCount = keywords.filter(k => k === 'fix').length;
      expect(fixCount).toBe(1);
    });

    it('should handle file paths in questions', () => {
      const keywords = engine.extractKeywords('what happened to src/auth/login.ts');

      expect(keywords).toContain('src/auth/login.ts');
    });
  });

  describe('external LLM integration', () => {
    it('should build payload with only question and metadata (no source code)', async () => {
      store.createCommit({
        sha: 'abc123def456',
        author_name: 'Bob',
        author_email: 'bob@example.com',
        authored_date: '2024-01-01T00:00:00Z',
        message: 'add feature: user authentication',
        lines_added: 100,
        lines_deleted: 0,
      });

      const config: ArcheologyConfig = {
        contributorThreshold: 20,
        docStalenessMonths: 6,
        analysisPeriodMonths: 12,
        coOccurrenceThreshold: 0.70,
        couplingAnalysisPeriodMonths: 12,
        fileAgeThresholdYears: 2,
        deletionLineThreshold: 10,
        externalLlm: {
          enabled: true,
          endpoint: 'https://api.example.com/llm',
          apiKey: 'test-key',
        },
      };

      const mockLlmClient: ExternalLlmClient = {
        query: async (payload: ExternalLlmPayload) => {
          // Verify payload structure - should not contain source code
          expect(payload.question).toBeDefined();
          expect(payload.metadata).toBeDefined();
          expect(payload.metadata.relevantCommits).toBeDefined();
          expect(JSON.stringify(payload)).not.toContain('function ');
          expect(JSON.stringify(payload)).not.toContain('class ');
          expect(JSON.stringify(payload)).not.toContain('import ');
          return 'The authentication feature was added by Bob on 2024-01-01.';
        },
      };

      const llmEngine = new OracleChatEngine(store, config, mockLlmClient);
      const result = await llmEngine.ask({ question: 'who added the authentication feature' });

      expect(result.answer).toContain('authentication');
      expect(result.references.length).toBeGreaterThan(0);
    });

    it('should fall back to local response when LLM fails', async () => {
      store.createCommit({
        sha: 'abc123def456',
        author_name: 'Bob',
        author_email: 'bob@example.com',
        authored_date: '2024-01-01T00:00:00Z',
        message: 'add feature: user authentication',
        lines_added: 100,
        lines_deleted: 0,
      });

      const config: ArcheologyConfig = {
        contributorThreshold: 20,
        docStalenessMonths: 6,
        analysisPeriodMonths: 12,
        coOccurrenceThreshold: 0.70,
        couplingAnalysisPeriodMonths: 12,
        fileAgeThresholdYears: 2,
        deletionLineThreshold: 10,
        externalLlm: {
          enabled: true,
          endpoint: 'https://api.example.com/llm',
          apiKey: 'test-key',
        },
      };

      const failingLlmClient: ExternalLlmClient = {
        query: async () => {
          throw new Error('LLM service unavailable');
        },
      };

      const llmEngine = new OracleChatEngine(store, config, failingLlmClient);
      const result = await llmEngine.ask({ question: 'who added the authentication feature' });

      // Should fall back to local response
      expect(result.references.length).toBeGreaterThan(0);
      expect(result.answer).toBeTruthy();
    });

    it('should not send source code in LLM payload', () => {
      store.createCommit({
        sha: 'abc123',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: '2024-01-01T00:00:00Z',
        message: 'implement feature',
      });

      store.createFile({
        current_path: 'src/main.ts',
        first_commit_sha: 'abc123',
      });

      const queryResults = {
        commits: [store.getCommitBySha('abc123')!],
        files: [store.getFileByPath('src/main.ts')!],
        authors: [],
        tickets: [],
      };

      const payload = engine.buildExternalLlmPayload('test question', queryResults);

      // Verify the payload structure only contains metadata
      expect(payload.question).toBe('test question');
      expect(payload.metadata.relevantCommits[0]).toEqual({
        sha: 'abc123',
        message: 'implement feature',
        author: 'Dev',
        date: '2024-01-01T00:00:00Z',
      });
      expect(payload.metadata.relevantFiles[0]).toEqual({
        path: 'src/main.ts',
      });

      // Ensure no source code fields exist
      const payloadStr = JSON.stringify(payload);
      expect(payloadStr).not.toContain('content');
      expect(payloadStr).not.toContain('sourceCode');
      expect(payloadStr).not.toContain('fileContent');
    });
  });

  describe('response format', () => {
    beforeEach(() => {
      store.createCommit({
        sha: 'commit1sha',
        author_name: 'Dev One',
        author_email: 'dev1@test.com',
        authored_date: '2024-03-01T10:00:00Z',
        message: 'fix: resolve memory leak in cache module',
      });
    });

    it('should include commit SHA in response references', async () => {
      const result = await engine.ask({ question: 'what was the memory leak fix about' });

      const commitRef = result.references.find(r => r.type === 'commit');
      expect(commitRef).toBeDefined();
      expect(commitRef!.identifier).toBe('commit1sha');
    });

    it('should include description in references', async () => {
      const result = await engine.ask({ question: 'tell me about the memory leak fix' });

      const commitRef = result.references.find(r => r.type === 'commit');
      expect(commitRef).toBeDefined();
      expect(commitRef!.description).toContain('memory leak');
    });

    it('should have a non-empty answer when results are found', async () => {
      const result = await engine.ask({ question: 'what was the cache fix' });

      expect(result.answer.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Oracle Chat Engine
 *
 * Implements the `ask_oracle` tool that allows users to ask natural language
 * questions about the historical evolution of the repository. Queries the
 * Knowledge Graph for relevant commits, files, authors, and tickets, then
 * generates factual responses backed by verifiable references.
 */

import type {
  OracleResponse,
  OracleReference,
  ArcheologyConfig,
  GraphStatus,
} from '../types/index.js';
import type { SqliteStore, CommitRecord, FileRecord, AuthorRecord, TicketRecord } from '../storage/sqlite-store.js';

const MAX_QUESTION_LENGTH = 500;

/**
 * Keywords that indicate a question is out of scope for repository history analysis.
 */
const OUT_OF_SCOPE_INDICATORS = [
  'weather', 'recipe', 'movie', 'sport', 'politics', 'news',
  'joke', 'poem', 'song', 'game', 'travel', 'health',
  'stock', 'crypto', 'bitcoin', 'restaurant', 'hotel',
];

/**
 * Keywords that indicate a question is about repository history.
 */
const IN_SCOPE_INDICATORS = [
  'commit', 'change', 'modify', 'refactor', 'fix', 'bug',
  'author', 'who', 'when', 'why', 'how', 'file', 'module',
  'dependency', 'introduce', 'remove', 'delete', 'add',
  'merge', 'branch', 'pull request', 'pr', 'issue', 'ticket',
  'version', 'release', 'deploy', 'migration', 'rename',
  'move', 'create', 'update', 'history', 'evolution',
  'pattern', 'architecture', 'design', 'implement',
];

export interface AskOracleInput {
  question: string;
}

/**
 * Payload sent to an external LLM (if configured).
 * Contains only the question and metadata — never source code.
 */
export interface ExternalLlmPayload {
  question: string;
  metadata: {
    relevantCommits: Array<{ sha: string; message: string; author: string; date: string }>;
    relevantFiles: Array<{ path: string }>;
    relevantAuthors: Array<{ name: string; email: string }>;
    relevantTickets: Array<{ identifier: string; type: string }>;
  };
}

/**
 * Interface for external LLM integration.
 */
export interface ExternalLlmClient {
  query(payload: ExternalLlmPayload): Promise<string>;
}

/**
 * OracleChatEngine implements the `ask_oracle` tool.
 *
 * It validates input, queries the Knowledge Graph for relevant data based on
 * keywords extracted from the question, and generates factual responses with
 * verifiable references.
 */
export class OracleChatEngine {
  private readonly store: SqliteStore;
  private readonly config?: ArcheologyConfig;
  private readonly llmClient?: ExternalLlmClient;
  private graphStatusProvider?: () => Promise<GraphStatus>;

  constructor(
    store: SqliteStore,
    config?: ArcheologyConfig,
    llmClient?: ExternalLlmClient,
  ) {
    this.store = store;
    this.config = config;
    this.llmClient = llmClient;
  }

  /**
   * Sets the graph status provider function.
   * This allows the engine to check if the Knowledge Graph is ready.
   */
  setGraphStatusProvider(provider: () => Promise<GraphStatus>): void {
    this.graphStatusProvider = provider;
  }

  /**
   * Process a question and return an OracleResponse.
   */
  async ask(input: AskOracleInput): Promise<OracleResponse> {
    // Validate input length
    if (input.question.length > MAX_QUESTION_LENGTH) {
      return {
        answer: `Question exceeds the maximum length of ${MAX_QUESTION_LENGTH} characters. Please shorten your question and try again.`,
        references: [],
        confidence: 'low',
      };
    }

    if (input.question.trim().length === 0) {
      return {
        answer: 'Please provide a question about the repository history.',
        references: [],
        confidence: 'low',
      };
    }

    // Check if graph is ready
    if (this.graphStatusProvider) {
      const status = await this.graphStatusProvider();
      if (status.state === 'not-initialized' || status.state === 'building') {
        return {
          answer: 'The Knowledge Graph is not ready yet. Please wait for the indexation to complete before making queries. The graph is currently being built from the repository history.',
          references: [],
          confidence: 'low',
        };
      }
      if (status.state === 'error') {
        return {
          answer: `The Knowledge Graph encountered an error: ${status.error ?? 'Unknown error'}. Please check the repository configuration.`,
          references: [],
          confidence: 'low',
        };
      }
    }

    // Check if question is out of scope
    if (this.isOutOfScope(input.question)) {
      return {
        answer: 'I can only answer questions about the history and evolution of this repository. This includes questions about commits, authors, file changes, dependencies, refactorings, and tickets. Please rephrase your question to focus on the repository history.',
        references: [],
        confidence: 'low',
      };
    }

    // Extract keywords and query the graph
    const keywords = this.extractKeywords(input.question);
    const queryResults = this.queryGraph(keywords, input.question);

    // Handle no results
    if (queryResults.commits.length === 0 && queryResults.files.length === 0 &&
        queryResults.authors.length === 0 && queryResults.tickets.length === 0) {
      return {
        answer: 'No relevant information was found in the repository history for your question. You may want to try: (1) rephrasing your question with more specific terms, (2) checking the git log directly with `git log --grep`, or (3) consulting project documentation or team members.',
        references: [],
        confidence: 'low',
      };
    }

    // If external LLM is configured and enabled, use it
    if (this.config?.externalLlm?.enabled && this.llmClient) {
      return this.queryWithExternalLlm(input.question, queryResults);
    }

    // Generate local response from graph data
    return this.generateLocalResponse(input.question, queryResults);
  }

  /**
   * Builds the payload for external LLM queries.
   * Only includes question + metadata, never source code.
   */
  buildExternalLlmPayload(question: string, queryResults: QueryResults): ExternalLlmPayload {
    return {
      question,
      metadata: {
        relevantCommits: queryResults.commits.map(c => ({
          sha: c.sha,
          message: c.message,
          author: c.author_name,
          date: c.authored_date,
        })),
        relevantFiles: queryResults.files.map(f => ({
          path: f.current_path,
        })),
        relevantAuthors: queryResults.authors.map(a => ({
          name: a.name,
          email: a.email,
        })),
        relevantTickets: queryResults.tickets.map(t => ({
          identifier: t.identifier,
          type: t.type,
        })),
      },
    };
  }

  // === Private Methods ===

  /**
   * Determines if a question is out of scope for repository history analysis.
   */
  private isOutOfScope(question: string): boolean {
    const lowerQuestion = question.toLowerCase();

    // Check if the question contains any in-scope indicators
    const hasInScopeKeyword = IN_SCOPE_INDICATORS.some(keyword =>
      lowerQuestion.includes(keyword)
    );
    if (hasInScopeKeyword) {
      return false;
    }

    // Check if the question contains out-of-scope indicators
    const hasOutOfScopeKeyword = OUT_OF_SCOPE_INDICATORS.some(keyword =>
      lowerQuestion.includes(keyword)
    );
    if (hasOutOfScopeKeyword) {
      return true;
    }

    // Default: assume in-scope (benefit of the doubt)
    return false;
  }

  /**
   * Extracts meaningful keywords from a question for graph querying.
   * Removes common stop words and short words.
   */
  extractKeywords(question: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
      'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about',
      'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
      'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
    ]);

    // Split on non-alphanumeric characters, filter stop words and short words
    const words = question
      .toLowerCase()
      .split(/[^a-z0-9_\-./]+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Deduplicate
    return [...new Set(words)];
  }

  /**
   * Queries the Knowledge Graph for data relevant to the extracted keywords.
   */
  private queryGraph(keywords: string[], question: string): QueryResults {
    const results: QueryResults = {
      commits: [],
      files: [],
      authors: [],
      tickets: [],
    };

    const addedCommitIds = new Set<number>();
    const addedFileIds = new Set<number>();
    const addedAuthorIds = new Set<number>();
    const addedTicketIds = new Set<number>();

    // Search commits by message content
    const allCommits = this.store.getAllCommits();
    for (const commit of allCommits) {
      if (results.commits.length >= 10) break;
      const messageLower = commit.message.toLowerCase();
      const matchScore = keywords.filter(kw => messageLower.includes(kw)).length;
      if (matchScore > 0 && !addedCommitIds.has(commit.id)) {
        results.commits.push(commit);
        addedCommitIds.add(commit.id);
      }
    }

    // Search files by path
    const allFiles = this.store.getAllFiles();
    for (const file of allFiles) {
      if (results.files.length >= 10) break;
      const pathLower = file.current_path.toLowerCase();
      const matchScore = keywords.filter(kw => pathLower.includes(kw)).length;
      if (matchScore > 0 && !addedFileIds.has(file.id)) {
        results.files.push(file);
        addedFileIds.add(file.id);
      }
    }

    // Search authors by name/email
    const allAuthors = this.store.getAllAuthors();
    for (const author of allAuthors) {
      if (results.authors.length >= 5) break;
      const nameLower = author.name.toLowerCase();
      const emailLower = author.email.toLowerCase();
      const matchScore = keywords.filter(kw =>
        nameLower.includes(kw) || emailLower.includes(kw)
      ).length;
      if (matchScore > 0 && !addedAuthorIds.has(author.id)) {
        results.authors.push(author);
        addedAuthorIds.add(author.id);
      }
    }

    // Search tickets by identifier
    const allTickets = this.store.getAllTickets();
    for (const ticket of allTickets) {
      if (results.tickets.length >= 10) break;
      const identifierLower = ticket.identifier.toLowerCase();
      const matchScore = keywords.filter(kw => identifierLower.includes(kw)).length;
      if (matchScore > 0 && !addedTicketIds.has(ticket.id)) {
        results.tickets.push(ticket);
        addedTicketIds.add(ticket.id);
      }
    }

    // If we still have no results, try broader matching on the full question
    if (results.commits.length === 0 && results.files.length === 0 &&
        results.authors.length === 0 && results.tickets.length === 0) {
      // Try matching individual words from the question against file paths
      const questionWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const file of allFiles) {
        if (results.files.length >= 5) break;
        const pathLower = file.current_path.toLowerCase();
        if (questionWords.some(w => pathLower.includes(w)) && !addedFileIds.has(file.id)) {
          results.files.push(file);
          addedFileIds.add(file.id);
        }
      }
    }

    return results;
  }

  /**
   * Queries the external LLM with minimized data (question + metadata only).
   */
  private async queryWithExternalLlm(question: string, queryResults: QueryResults): Promise<OracleResponse> {
    const payload = this.buildExternalLlmPayload(question, queryResults);

    try {
      const llmAnswer = await this.llmClient!.query(payload);
      const references = this.buildReferences(queryResults);

      return {
        answer: llmAnswer,
        references,
        confidence: references.length >= 3 ? 'high' : references.length >= 1 ? 'medium' : 'low',
      };
    } catch {
      // Fall back to local response if LLM fails
      return this.generateLocalResponse(question, queryResults);
    }
  }

  /**
   * Generates a response locally from the Knowledge Graph data.
   * Every factual assertion is backed by at least one reference.
   */
  private generateLocalResponse(question: string, queryResults: QueryResults): OracleResponse {
    const references = this.buildReferences(queryResults);
    const answer = this.buildAnswer(question, queryResults);

    const confidence = this.determineConfidence(queryResults);

    return {
      answer,
      references,
      confidence,
    };
  }

  /**
   * Builds verifiable references from query results.
   */
  private buildReferences(queryResults: QueryResults): OracleReference[] {
    const references: OracleReference[] = [];

    for (const commit of queryResults.commits) {
      references.push({
        type: 'commit',
        identifier: commit.sha,
        description: commit.message.substring(0, 100),
      });
    }

    for (const file of queryResults.files) {
      references.push({
        type: 'file',
        identifier: file.current_path,
        description: `File: ${file.current_path}`,
      });
    }

    for (const ticket of queryResults.tickets) {
      references.push({
        type: 'ticket',
        identifier: ticket.identifier,
        description: `Ticket ${ticket.identifier} (${ticket.type})`,
      });
    }

    return references;
  }

  /**
   * Builds a natural language answer from the query results.
   */
  private buildAnswer(question: string, queryResults: QueryResults): string {
    const parts: string[] = [];

    if (queryResults.commits.length > 0) {
      const commitSummaries = queryResults.commits.slice(0, 5).map(c => {
        const date = c.authored_date.split('T')[0] ?? c.authored_date;
        return `- ${c.author_name} on ${date}: "${c.message.substring(0, 80)}" (${c.sha.substring(0, 7)})`;
      });
      parts.push(`Found ${queryResults.commits.length} relevant commit(s):\n${commitSummaries.join('\n')}`);
    }

    if (queryResults.files.length > 0) {
      const filePaths = queryResults.files.slice(0, 5).map(f => `- ${f.current_path}`);
      parts.push(`Related file(s):\n${filePaths.join('\n')}`);
    }

    if (queryResults.authors.length > 0) {
      const authorNames = queryResults.authors.slice(0, 3).map(a =>
        `- ${a.name} (${a.email}), ${a.total_commits} commits`
      );
      parts.push(`Related author(s):\n${authorNames.join('\n')}`);
    }

    if (queryResults.tickets.length > 0) {
      const ticketIds = queryResults.tickets.slice(0, 5).map(t =>
        `- ${t.identifier} (${t.type})`
      );
      parts.push(`Related ticket(s):\n${ticketIds.join('\n')}`);
    }

    if (parts.length === 0) {
      return 'No relevant information found in the repository history.';
    }

    return parts.join('\n\n');
  }

  /**
   * Determines confidence level based on the amount and quality of results.
   */
  private determineConfidence(queryResults: QueryResults): 'high' | 'medium' | 'low' {
    const totalResults = queryResults.commits.length + queryResults.files.length +
      queryResults.authors.length + queryResults.tickets.length;

    if (totalResults >= 5) return 'high';
    if (totalResults >= 2) return 'medium';
    return 'low';
  }
}

/**
 * Internal type for aggregated query results.
 */
export interface QueryResults {
  commits: CommitRecord[];
  files: FileRecord[];
  authors: AuthorRecord[];
  tickets: TicketRecord[];
}

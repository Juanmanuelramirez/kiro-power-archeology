import type {
  GitAdapter,
  BlameEntry,
  IntentAnalysisResult,
  CommitIntent,
} from '../types/index.js';
import { extractTickets } from '../core/ticket-extractor.js';

const MAX_LINE_RANGE = 500;
const MAX_COMMITS = 10;
const MAX_SUMMARY_CHARS = 500;
const MAX_DISCUSSION_CHARS = 300;

/**
 * PR reference patterns found in commit messages.
 * Matches patterns like "(#123)" or "Merge pull request #123"
 */
const PR_PATTERNS = [
  /\(#(\d+)\)/,                          // (#123)
  /Merge pull request #(\d+)/i,          // Merge pull request #123
  /pull request #(\d+)/i,                // pull request #123
];

export interface AnalyzeIntentInput {
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * GitIntentAnalyzer implements the `analyze_intent` tool.
 *
 * It uses git blame to identify commits that modified a given line range,
 * groups them by unique commit SHA, orders by date descending, and generates
 * natural language summaries for each commit.
 */
export class GitIntentAnalyzer {
  private readonly gitAdapter: GitAdapter;

  constructor(gitAdapter: GitAdapter) {
    this.gitAdapter = gitAdapter;
  }

  /**
   * Analyze the intent behind a range of lines in a file.
   */
  async analyze(input: AnalyzeIntentInput): Promise<IntentAnalysisResult> {
    const { file, startLine, endLine } = input;

    // Validate line range
    const lineCount = endLine - startLine + 1;
    if (lineCount < 1 || lineCount > MAX_LINE_RANGE) {
      return {
        file,
        lineRange: { start: startLine, end: endLine },
        commits: [],
        summary: `Invalid line range: must be between 1 and ${MAX_LINE_RANGE} lines. Requested ${lineCount} lines.`,
      };
    }

    if (startLine < 1) {
      return {
        file,
        lineRange: { start: startLine, end: endLine },
        commits: [],
        summary: 'Invalid line range: startLine must be at least 1.',
      };
    }

    // Get blame entries
    let blameEntries: BlameEntry[];
    try {
      blameEntries = await this.gitAdapter.blame(file, startLine, endLine);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        file,
        lineRange: { start: startLine, end: endLine },
        commits: [],
        summary: `No history available for the selected lines: ${message}`,
      };
    }

    if (blameEntries.length === 0) {
      return {
        file,
        lineRange: { start: startLine, end: endLine },
        commits: [],
        summary: 'No history found for the selected lines.',
      };
    }

    // Group by unique commit SHA and deduplicate
    const commitMap = new Map<string, BlameEntry>();
    for (const entry of blameEntries) {
      if (!commitMap.has(entry.commitSha)) {
        commitMap.set(entry.commitSha, entry);
      }
    }

    // Get commit details and sort by date descending (most recent first)
    const uniqueEntries = Array.from(commitMap.values());
    uniqueEntries.sort((a, b) => {
      const dateA = new Date(a.authorDate).getTime();
      const dateB = new Date(b.authorDate).getTime();
      return dateB - dateA;
    });

    // Cap at MAX_COMMITS
    const cappedEntries = uniqueEntries.slice(0, MAX_COMMITS);

    // Build CommitIntent for each unique commit
    const commits: CommitIntent[] = [];
    for (const entry of cappedEntries) {
      let commitMessage = '';
      try {
        const detail = await this.gitAdapter.show(entry.commitSha);
        commitMessage = detail.message;
      } catch {
        // If show fails, use empty message
        commitMessage = '';
      }

      const commitIntent = this.buildCommitIntent(entry, commitMessage);
      commits.push(commitIntent);
    }

    // Generate overall summary
    const summary = this.generateOverallSummary(file, startLine, endLine, commits);

    return {
      file,
      lineRange: { start: startLine, end: endLine },
      commits,
      summary,
    };
  }

  /**
   * Build a CommitIntent from a blame entry and its full commit message.
   */
  private buildCommitIntent(entry: BlameEntry, commitMessage: string): CommitIntent {
    const prRef = this.extractPullRequest(commitMessage);
    const issueRefs = this.extractIssueRefs(commitMessage);
    const discussionSummary = this.generateDiscussionSummary(issueRefs, prRef);
    const naturalLanguageSummary = this.generateNaturalLanguageSummary(
      entry,
      commitMessage,
      prRef,
      issueRefs
    );

    const intent: CommitIntent = {
      sha: entry.commitSha,
      author: entry.author,
      date: entry.authorDate,
      message: commitMessage || '(no commit message)',
      naturalLanguageSummary,
      issueRefs: issueRefs.map((r) => r.identifier),
    };

    if (prRef) {
      intent.pullRequest = prRef;
    }

    if (discussionSummary) {
      intent.discussionSummary = discussionSummary;
    }

    return intent;
  }

  /**
   * Extract PR reference from commit message.
   * Returns the PR number and uses the commit message first line as title.
   */
  private extractPullRequest(
    message: string
  ): { number: number; title: string } | undefined {
    if (!message) return undefined;

    for (const pattern of PR_PATTERNS) {
      const match = message.match(pattern);
      if (match) {
        const prNumber = parseInt(match[1], 10);
        // Use the first line of the commit message as the PR title
        const title = message.split('\n')[0].trim();
        return { number: prNumber, title };
      }
    }

    return undefined;
  }

  /**
   * Extract issue/ticket references from commit message using the ticket extractor.
   */
  private extractIssueRefs(message: string): { identifier: string; type: string }[] {
    if (!message) return [];
    const tickets = extractTickets(message);
    return tickets.map((t) => ({ identifier: t.identifier, type: t.type }));
  }

  /**
   * Generate a discussion summary when issue references or PR references exist.
   * Max 300 characters.
   */
  private generateDiscussionSummary(
    issueRefs: { identifier: string; type: string }[],
    prRef: { number: number; title: string } | undefined
  ): string | undefined {
    if (issueRefs.length === 0 && !prRef) {
      return undefined;
    }

    const parts: string[] = [];

    if (prRef) {
      parts.push(`PR #${prRef.number}: ${prRef.title}`);
    }

    if (issueRefs.length > 0) {
      const refs = issueRefs.map((r) => r.identifier).join(', ');
      parts.push(`Related issues: ${refs}`);
    }

    const summary = parts.join('. ');
    return truncate(summary, MAX_DISCUSSION_CHARS);
  }

  /**
   * Generate a natural language summary for a commit.
   * Max 500 characters. Includes author, date, PR/issue refs if available.
   */
  private generateNaturalLanguageSummary(
    entry: BlameEntry,
    commitMessage: string,
    prRef: { number: number; title: string } | undefined,
    issueRefs: { identifier: string; type: string }[]
  ): string {
    const date = formatDate(entry.authorDate);
    const parts: string[] = [];

    parts.push(`${entry.author} on ${date}`);

    if (commitMessage) {
      const firstLine = commitMessage.split('\n')[0].trim();
      parts.push(firstLine);
    }

    if (prRef) {
      parts.push(`(PR #${prRef.number})`);
    }

    if (issueRefs.length > 0) {
      const refs = issueRefs.map((r) => r.identifier).join(', ');
      parts.push(`[${refs}]`);
    }

    if (!prRef && issueRefs.length === 0) {
      parts.push('No PR or issue references found for this commit.');
    }

    const summary = parts.join(' — ');
    return truncate(summary, MAX_SUMMARY_CHARS);
  }

  /**
   * Generate an overall summary for the intent analysis result.
   */
  private generateOverallSummary(
    file: string,
    startLine: number,
    endLine: number,
    commits: CommitIntent[]
  ): string {
    if (commits.length === 0) {
      return `No commits found for ${file} lines ${startLine}-${endLine}.`;
    }

    const authors = [...new Set(commits.map((c) => c.author))];
    const authorStr =
      authors.length <= 3
        ? authors.join(', ')
        : `${authors.slice(0, 3).join(', ')} and ${authors.length - 3} others`;

    return truncate(
      `${commits.length} commit(s) found for ${file} lines ${startLine}-${endLine}. Contributors: ${authorStr}.`,
      MAX_SUMMARY_CHARS
    );
  }
}

/**
 * Truncate a string to a maximum length, appending "..." if truncated.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format an ISO date string to a human-readable short format.
 */
function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  } catch {
    return isoDate;
  }
}

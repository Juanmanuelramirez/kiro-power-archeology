import type {
  GitAdapter,
  BlameEntry,
  RefactorSafetyResult,
  RefactorWarning,
} from '../types/index.js';
import { extractTickets } from '../core/ticket-extractor.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_DELETION_LINE_THRESHOLD = 10;

/**
 * Keywords that indicate a commit was related to a bug fix or edge case.
 * "high" severity keywords indicate direct bug/fix associations.
 */
const BUG_FIX_KEYWORDS = [
  'fix',
  'bug',
  'edge case',
  'edge-case',
  'hotfix',
  'patch',
  'workaround',
  'hack',
];

/**
 * PR reference patterns found in commit messages.
 * Used to extract PR numbers for warnings.
 */
const PR_PATTERNS = [
  /\(#(\d+)\)/,
  /Merge pull request #(\d+)/i,
  /pull request #(\d+)/i,
  /#(\d+)/,
];

export interface CheckRefactorSafetyInput {
  file: string;
  startLine: number;
  endLine: number;
}

export interface PreRefactorSafetyCheckerOptions {
  timeoutMs?: number;
  deletionLineThreshold?: number;
}

/**
 * PreRefactorSafetyChecker implements the `check_refactor_safety` tool.
 *
 * It analyzes deleted lines to determine if they are associated with bug fixes
 * or edge cases, generating warnings when potentially dangerous deletions are detected.
 */
export class PreRefactorSafetyChecker {
  private readonly gitAdapter: GitAdapter;
  private readonly timeoutMs: number;
  private readonly deletionLineThreshold: number;

  constructor(gitAdapter: GitAdapter, options: PreRefactorSafetyCheckerOptions = {}) {
    this.gitAdapter = gitAdapter;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.deletionLineThreshold = options.deletionLineThreshold ?? DEFAULT_DELETION_LINE_THRESHOLD;
  }

  /**
   * Check if deleting a range of lines is safe by analyzing their git history.
   */
  async check(input: CheckRefactorSafetyInput): Promise<RefactorSafetyResult> {
    const { file, startLine, endLine } = input;
    const lineCount = endLine - startLine + 1;

    // Only trigger analysis when more than the threshold of consecutive lines are being deleted
    if (lineCount <= this.deletionLineThreshold) {
      return { safe: true, warnings: [], analysisCompleted: true };
    }

    // Wrap the analysis in a timeout
    try {
      return await this.withTimeout(this.performAnalysis(file, startLine, endLine));
    } catch (error: unknown) {
      // Timeout or unexpected error — allow operation without blocking
      return { safe: true, warnings: [], analysisCompleted: false };
    }
  }

  /**
   * Perform the actual safety analysis by checking blame and commit messages.
   */
  private async performAnalysis(
    file: string,
    startLine: number,
    endLine: number
  ): Promise<RefactorSafetyResult> {
    // Get blame entries for the line range
    let blameEntries: BlameEntry[];
    try {
      blameEntries = await this.gitAdapter.blame(file, startLine, endLine);
    } catch {
      // Missing git history — allow operation without blocking
      return { safe: true, warnings: [], analysisCompleted: false };
    }

    if (blameEntries.length === 0) {
      return { safe: true, warnings: [], analysisCompleted: true };
    }

    // Get unique commit SHAs
    const uniqueShas = new Set<string>();
    for (const entry of blameEntries) {
      uniqueShas.add(entry.commitSha);
    }

    // For each unique commit, check if its message contains bug/fix/edge-case keywords
    const warnings: RefactorWarning[] = [];

    for (const sha of uniqueShas) {
      try {
        const commitDetail = await this.gitAdapter.show(sha);
        const warning = this.analyzeCommitMessage(sha, commitDetail.message);
        if (warning) {
          warnings.push(warning);
        }
      } catch {
        // If we can't get commit details, skip this commit
        continue;
      }
    }

    return {
      safe: warnings.length === 0,
      warnings,
      analysisCompleted: true,
    };
  }

  /**
   * Analyze a commit message for bug/fix/edge-case keywords and ticket references.
   * Returns a warning if relevant keywords or ticket refs are found.
   */
  private analyzeCommitMessage(sha: string, message: string): RefactorWarning | null {
    if (!message || message.trim().length === 0) {
      return null;
    }

    const lowerMessage = message.toLowerCase();

    // Check for bug/fix keywords (high severity)
    const hasKeyword = BUG_FIX_KEYWORDS.some((keyword) =>
      lowerMessage.includes(keyword)
    );

    // Check for ticket/issue references
    const tickets = extractTickets(message);
    const hasTicketRefs = tickets.length > 0;

    if (!hasKeyword && !hasTicketRefs) {
      return null;
    }

    // Determine severity
    const severity: 'high' | 'medium' = hasKeyword ? 'high' : 'medium';

    // Determine case identifier
    const caseId = tickets.length > 0
      ? tickets[0].identifier
      : sha.slice(0, 7);

    // Extract description from commit message (first line)
    const description = message.split('\n')[0].trim();

    // Extract PR number if present
    const prNumber = this.extractPrNumber(message);

    const warning: RefactorWarning = {
      caseId,
      description,
      commitSha: sha,
      severity,
    };

    if (prNumber !== undefined) {
      warning.prNumber = prNumber;
    }

    return warning;
  }

  /**
   * Extract a PR number from a commit message.
   */
  private extractPrNumber(message: string): number | undefined {
    for (const pattern of PR_PATTERNS) {
      const match = message.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return undefined;
  }

  /**
   * Wrap a promise with a timeout. If the timeout is exceeded,
   * the promise rejects with a timeout error.
   */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Analysis timed out'));
      }, this.timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

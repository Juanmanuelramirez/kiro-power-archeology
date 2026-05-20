/**
 * Ticket Extractor
 *
 * Extracts ticket references from commit messages using regex patterns.
 * Supports JIRA-style (PROJ-123), GitHub issues (#456), and two-letter prefix (GH-789).
 */

export type TicketType = 'jira' | 'github' | 'short-prefix';

export interface TicketReference {
  identifier: string;
  type: TicketType;
}

interface TicketPattern {
  regex: RegExp;
  type: TicketType;
  extractGroup: number;
}

const TICKET_PATTERNS: TicketPattern[] = [
  {
    // Two-letter prefix: exactly 2 uppercase letters, then dash and number
    // Processed first so GH-789, AB-1 are classified as short-prefix
    // before the broader JIRA pattern can match them.
    regex: /\b([A-Z]{2}-\d+)\b/g,
    type: 'short-prefix',
    extractGroup: 1,
  },
  {
    // JIRA-style: prefix of 2+ uppercase/digit chars (starting with uppercase),
    // then dash and number. Examples: PROJ-123, ABC-1, TEAM-9999, AB2C-45
    // Matches [A-Z][A-Z0-9]+-\d+ per the design spec.
    regex: /([A-Z][A-Z0-9]+-\d+)/g,
    type: 'jira',
    extractGroup: 1,
  },
  {
    // GitHub issues: # followed by digits
    // Examples: #1, #123, #9999
    regex: /#(\d+)/g,
    type: 'github',
    extractGroup: 1,
  },
];

/**
 * Extracts all ticket references from a commit message.
 * Deduplicates results so the same identifier only appears once.
 * Returns an empty array for empty messages or messages with no ticket references.
 */
export function extractTickets(message: string): TicketReference[] {
  if (!message || message.trim().length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const results: TicketReference[] = [];

  for (const pattern of TICKET_PATTERNS) {
    // Reset regex lastIndex for each invocation
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
      const identifier = pattern.type === 'github' ? `#${match[pattern.extractGroup]}` : match[pattern.extractGroup];

      // Deduplicate: skip if we've already seen this identifier
      if (seen.has(identifier)) {
        continue;
      }

      // For short-prefix pattern, skip if already captured as jira (jira is more specific)
      if (pattern.type === 'short-prefix' && seen.has(identifier)) {
        continue;
      }

      seen.add(identifier);
      results.push({
        identifier,
        type: pattern.type,
      });
    }
  }

  return results;
}

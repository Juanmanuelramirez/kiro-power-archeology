import { describe, it, expect } from 'vitest';
import { extractTickets, TicketReference } from './ticket-extractor';

describe('ticket-extractor', () => {
  describe('JIRA-style tickets', () => {
    it('extracts standard JIRA ticket (PROJ-123)', () => {
      const result = extractTickets('Fix bug in PROJ-123');
      expect(result).toContainEqual({ identifier: 'PROJ-123', type: 'jira' });
    });

    it('extracts ticket with single digit (ABC-1)', () => {
      const result = extractTickets('Implement ABC-1 feature');
      expect(result).toContainEqual({ identifier: 'ABC-1', type: 'jira' });
    });

    it('extracts ticket with large number (TEAM-9999)', () => {
      const result = extractTickets('Close TEAM-9999');
      expect(result).toContainEqual({ identifier: 'TEAM-9999', type: 'jira' });
    });

    it('extracts ticket with alphanumeric prefix (AB2C-45)', () => {
      const result = extractTickets('Relates to AB2C-45');
      expect(result).toContainEqual({ identifier: 'AB2C-45', type: 'jira' });
    });

    it('extracts multiple JIRA tickets', () => {
      const result = extractTickets('Fix PROJ-123 and TEAM-456');
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ identifier: 'PROJ-123', type: 'jira' });
      expect(result).toContainEqual({ identifier: 'TEAM-456', type: 'jira' });
    });
  });

  describe('GitHub issues', () => {
    it('extracts single digit issue (#1)', () => {
      const result = extractTickets('Fixes #1');
      expect(result).toContainEqual({ identifier: '#1', type: 'github' });
    });

    it('extracts multi-digit issue (#123)', () => {
      const result = extractTickets('Closes #123');
      expect(result).toContainEqual({ identifier: '#123', type: 'github' });
    });

    it('extracts large issue number (#9999)', () => {
      const result = extractTickets('Related to #9999');
      expect(result).toContainEqual({ identifier: '#9999', type: 'github' });
    });

    it('extracts multiple GitHub issues', () => {
      const result = extractTickets('Fixes #1 and #2');
      const githubRefs = result.filter(r => r.type === 'github');
      expect(githubRefs).toHaveLength(2);
      expect(githubRefs).toContainEqual({ identifier: '#1', type: 'github' });
      expect(githubRefs).toContainEqual({ identifier: '#2', type: 'github' });
    });
  });

  describe('Two-letter prefix tickets', () => {
    it('extracts GH-789', () => {
      const result = extractTickets('See GH-789 for details');
      expect(result).toContainEqual({ identifier: 'GH-789', type: 'short-prefix' });
    });

    it('extracts AB-1', () => {
      const result = extractTickets('Linked to AB-1');
      expect(result).toContainEqual({ identifier: 'AB-1', type: 'short-prefix' });
    });

    it('extracts two-letter prefix with large number', () => {
      const result = extractTickets('Fix XY-12345');
      expect(result).toContainEqual({ identifier: 'XY-12345', type: 'short-prefix' });
    });
  });

  describe('multiple ticket types in one message', () => {
    it('extracts JIRA and GitHub tickets from same message', () => {
      const result = extractTickets('Fix PROJ-123, closes #456');
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result).toContainEqual({ identifier: 'PROJ-123', type: 'jira' });
      expect(result).toContainEqual({ identifier: '#456', type: 'github' });
    });

    it('extracts all three types from same message', () => {
      const result = extractTickets('PROJ-123: fix #456, see also GH-789');
      expect(result).toContainEqual({ identifier: 'PROJ-123', type: 'jira' });
      expect(result).toContainEqual({ identifier: '#456', type: 'github' });
      // GH-789 may be captured as jira (since GH matches [A-Z][A-Z0-9]+) or short-prefix
      const gh789 = result.find(r => r.identifier === 'GH-789');
      expect(gh789).toBeDefined();
    });
  });

  describe('no tickets found', () => {
    it('returns empty array for message with no tickets', () => {
      const result = extractTickets('Just a regular commit message');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      const result = extractTickets('');
      expect(result).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      const result = extractTickets('   \n\t  ');
      expect(result).toEqual([]);
    });
  });

  describe('deduplication', () => {
    it('deduplicates repeated JIRA ticket', () => {
      const result = extractTickets('PROJ-123 is related to PROJ-123');
      const proj123 = result.filter(r => r.identifier === 'PROJ-123');
      expect(proj123).toHaveLength(1);
    });

    it('deduplicates repeated GitHub issue', () => {
      const result = extractTickets('Fixes #42, also see #42');
      const issue42 = result.filter(r => r.identifier === '#42');
      expect(issue42).toHaveLength(1);
    });

    it('deduplicates ticket matched by multiple patterns', () => {
      // GH-123 matches both JIRA pattern ([A-Z][A-Z0-9]+-\d+) and short-prefix ([A-Z]{2}-\d+)
      const result = extractTickets('See GH-123');
      const gh123 = result.filter(r => r.identifier === 'GH-123');
      expect(gh123).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('does not match lowercase prefixes', () => {
      const result = extractTickets('proj-123 is not a valid ticket');
      const jiraTickets = result.filter(r => r.identifier === 'proj-123');
      expect(jiraTickets).toHaveLength(0);
    });

    it('does not match single letter prefix', () => {
      const result = extractTickets('A-123 is not valid');
      const tickets = result.filter(r => r.identifier === 'A-123');
      expect(tickets).toHaveLength(0);
    });

    it('does not match hash without number', () => {
      const result = extractTickets('This is a # comment');
      const githubTickets = result.filter(r => r.type === 'github');
      expect(githubTickets).toHaveLength(0);
    });

    it('handles ticket at start of message', () => {
      const result = extractTickets('PROJ-1 initial commit');
      expect(result).toContainEqual({ identifier: 'PROJ-1', type: 'jira' });
    });

    it('handles ticket at end of message', () => {
      const result = extractTickets('Fix for PROJ-1');
      expect(result).toContainEqual({ identifier: 'PROJ-1', type: 'jira' });
    });

    it('handles message with only a ticket reference', () => {
      const result = extractTickets('PROJ-123');
      expect(result).toContainEqual({ identifier: 'PROJ-123', type: 'jira' });
    });

    it('handles multiline commit messages', () => {
      const message = 'Fix critical bug\n\nRelated to PROJ-123\nAlso fixes #456';
      const result = extractTickets(message);
      expect(result).toContainEqual({ identifier: 'PROJ-123', type: 'jira' });
      expect(result).toContainEqual({ identifier: '#456', type: 'github' });
    });
  });
});

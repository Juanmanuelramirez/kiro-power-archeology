import { describe, it, expect } from 'vitest';
import {
  calculateChurnScore,
  validateHistoryPeriod,
  CONTRIBUTOR_WEIGHT,
  COMMIT_WEIGHT,
  MINIMUM_HISTORY_MONTHS,
} from './churn-calculator';

describe('churn-calculator', () => {
  describe('calculateChurnScore', () => {
    it('calculates score with known inputs', () => {
      // 5 contributors * 3 + 10 commits * 1 = 25
      expect(calculateChurnScore(5, 10)).toBe(5 * CONTRIBUTOR_WEIGHT + 10 * COMMIT_WEIGHT);
      expect(calculateChurnScore(5, 10)).toBe(25);
    });

    it('is deterministic — same inputs always produce same output', () => {
      const result1 = calculateChurnScore(7, 20);
      const result2 = calculateChurnScore(7, 20);
      const result3 = calculateChurnScore(7, 20);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('returns 0 when both contributors and commits are zero', () => {
      expect(calculateChurnScore(0, 0)).toBe(0);
    });

    it('handles zero contributors with non-zero commits', () => {
      expect(calculateChurnScore(0, 15)).toBe(15 * COMMIT_WEIGHT);
    });

    it('handles non-zero contributors with zero commits', () => {
      expect(calculateChurnScore(8, 0)).toBe(8 * CONTRIBUTOR_WEIGHT);
    });

    it('handles large values correctly', () => {
      const contributors = 1000;
      const commits = 50000;
      const expected = (contributors * CONTRIBUTOR_WEIGHT) + (commits * COMMIT_WEIGHT);

      expect(calculateChurnScore(contributors, commits)).toBe(expected);
    });

    it('weights contributors more heavily than commits', () => {
      // With equal counts, contributors should contribute more to the score
      const sameValue = 10;
      const score = calculateChurnScore(sameValue, sameValue);
      const contributorPortion = sameValue * CONTRIBUTOR_WEIGHT;
      const commitPortion = sameValue * COMMIT_WEIGHT;

      expect(contributorPortion).toBeGreaterThan(commitPortion);
      expect(score).toBe(contributorPortion + commitPortion);
    });
  });

  describe('validateHistoryPeriod', () => {
    it('passes when history meets the minimum (exactly 3 months)', () => {
      const result = validateHistoryPeriod(3);
      expect(result.valid).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('passes when history exceeds the minimum', () => {
      const result = validateHistoryPeriod(12);
      expect(result.valid).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('fails when history is less than 3 months', () => {
      const result = validateHistoryPeriod(2);
      expect(result.valid).toBe(false);
      expect(result.message).toBeDefined();
      expect(result.message).toContain('3 meses');
    });

    it('fails when history is 0 months', () => {
      const result = validateHistoryPeriod(0);
      expect(result.valid).toBe(false);
      expect(result.message).toBeDefined();
    });

    it('fails when history is 1 month', () => {
      const result = validateHistoryPeriod(1);
      expect(result.valid).toBe(false);
    });

    it('includes the available months in the error message', () => {
      const result = validateHistoryPeriod(2);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('2');
    });
  });

  describe('exported constants', () => {
    it('exports CONTRIBUTOR_WEIGHT as a positive number', () => {
      expect(CONTRIBUTOR_WEIGHT).toBeGreaterThan(0);
    });

    it('exports COMMIT_WEIGHT as a positive number', () => {
      expect(COMMIT_WEIGHT).toBeGreaterThan(0);
    });

    it('exports MINIMUM_HISTORY_MONTHS as 3', () => {
      expect(MINIMUM_HISTORY_MONTHS).toBe(3);
    });

    it('CONTRIBUTOR_WEIGHT is greater than COMMIT_WEIGHT', () => {
      expect(CONTRIBUTOR_WEIGHT).toBeGreaterThan(COMMIT_WEIGHT);
    });
  });
});

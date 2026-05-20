import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LogicalCouplingAnalyzer } from './logical-coupling.js';
import { SqliteStore } from '../storage/sqlite-store.js';

/**
 * Helper to create a date N months ago from now.
 */
function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/**
 * Sets up a store with test data for logical coupling analysis.
 * Creates files and commits with known co-occurrence patterns.
 */
function setupTestStore(): {
  store: SqliteStore;
  files: { main: number; coupled: number; weakly: number; unrelated: number };
} {
  const store = new SqliteStore(':memory:');

  // Create files
  const mainFile = store.createFile({ current_path: 'src/main.ts' });
  const coupledFile = store.createFile({ current_path: 'src/coupled.ts' });
  const weaklyFile = store.createFile({ current_path: 'src/weakly.ts' });
  const unrelatedFile = store.createFile({ current_path: 'src/unrelated.ts' });

  // Create commits within analysis period (last 12 months)
  // Commits 1-5: main + coupled modified together (5 shared)
  for (let i = 1; i <= 5; i++) {
    const commit = store.createCommit({
      sha: `shared-${i}`,
      author_name: 'Dev',
      author_email: 'dev@test.com',
      authored_date: monthsAgo(i),
      message: `shared commit ${i}`,
    });
    store.createCommitFile({ commit_id: commit.id, file_id: mainFile.id });
    store.createCommitFile({ commit_id: commit.id, file_id: coupledFile.id });
  }

  // Commit 6: only main modified
  const commit6 = store.createCommit({
    sha: 'main-only-1',
    author_name: 'Dev',
    author_email: 'dev@test.com',
    authored_date: monthsAgo(6),
    message: 'main only commit',
  });
  store.createCommitFile({ commit_id: commit6.id, file_id: mainFile.id });

  // Commit 7: main + weakly modified together (1 shared)
  const commit7 = store.createCommit({
    sha: 'weak-shared-1',
    author_name: 'Dev',
    author_email: 'dev@test.com',
    authored_date: monthsAgo(2),
    message: 'weakly shared commit',
  });
  store.createCommitFile({ commit_id: commit7.id, file_id: mainFile.id });
  store.createCommitFile({ commit_id: commit7.id, file_id: weaklyFile.id });

  // Commits 8-10: only weakly modified (3 solo commits for weakly)
  for (let i = 8; i <= 10; i++) {
    const commit = store.createCommit({
      sha: `weakly-only-${i}`,
      author_name: 'Dev',
      author_email: 'dev@test.com',
      authored_date: monthsAgo(i - 5),
      message: `weakly only commit ${i}`,
    });
    store.createCommitFile({ commit_id: commit.id, file_id: weaklyFile.id });
  }

  // Commit 11: only unrelated modified
  const commit11 = store.createCommit({
    sha: 'unrelated-1',
    author_name: 'Dev',
    author_email: 'dev@test.com',
    authored_date: monthsAgo(1),
    message: 'unrelated commit',
  });
  store.createCommitFile({ commit_id: commit11.id, file_id: unrelatedFile.id });

  return {
    store,
    files: {
      main: mainFile.id,
      coupled: coupledFile.id,
      weakly: weaklyFile.id,
      unrelated: unrelatedFile.id,
    },
  };
}

describe('LogicalCouplingAnalyzer', () => {
  let store: SqliteStore;

  afterEach(() => {
    if (store) {
      store.close();
    }
  });

  describe('input validation', () => {
    beforeEach(() => {
      store = new SqliteStore(':memory:');
    });

    it('throws when coOccurrenceThreshold is below 50%', () => {
      const analyzer = new LogicalCouplingAnalyzer(store);

      expect(() =>
        analyzer.analyze({ file: 'src/main.ts', coOccurrenceThreshold: 0.49 })
      ).toThrow('coOccurrenceThreshold must be at least 0.5');
    });

    it('throws when analysisPeriodMonths is below 3', () => {
      const analyzer = new LogicalCouplingAnalyzer(store);

      expect(() =>
        analyzer.analyze({ file: 'src/main.ts', analysisPeriodMonths: 2 })
      ).toThrow('analysisPeriodMonths must be at least 3');
    });

    it('accepts threshold at exactly 50%', () => {
      const analyzer = new LogicalCouplingAnalyzer(store);

      // Should not throw
      const result = analyzer.analyze({ file: 'src/main.ts', coOccurrenceThreshold: 0.50 });
      expect(result).toBeDefined();
    });

    it('accepts period at exactly 3 months', () => {
      const analyzer = new LogicalCouplingAnalyzer(store);

      // Should not throw
      const result = analyzer.analyze({ file: 'src/main.ts', analysisPeriodMonths: 3 });
      expect(result).toBeDefined();
    });
  });

  describe('co-occurrence calculation', () => {
    it('calculates co-occurrence ratio as shared / union of commits', () => {
      const { store: testStore } = setupTestStore();
      store = testStore;
      const analyzer = new LogicalCouplingAnalyzer(store);

      // main has 7 commits in period (shared-1..5, main-only-1, weak-shared-1)
      // coupled has 5 commits in period (shared-1..5)
      // shared = 5, union = 7 (all of main's commits that also include coupled's)
      // co-occurrence = 5/7 ≈ 71.4%
      const result = analyzer.analyze({ file: 'src/main.ts', coOccurrenceThreshold: 0.50 });

      const coupledEntry = result.coupledFiles.find((f) => f.path === 'src/coupled.ts');
      expect(coupledEntry).toBeDefined();
      // 5 shared / 7 union = 71.4% → rounds to 71
      expect(coupledEntry!.coOccurrencePercentage).toBe(71);
      expect(coupledEntry!.sharedCommits).toBe(5);
    });

    it('filters out pairs below the threshold', () => {
      const { store: testStore } = setupTestStore();
      store = testStore;
      const analyzer = new LogicalCouplingAnalyzer(store);

      // With default 70% threshold, weakly coupled file should be excluded
      // weakly: 1 shared / (7 main + 4 weakly - 1 shared) = 1/10 = 10%
      const result = analyzer.analyze({ file: 'src/main.ts' });

      const weakEntry = result.coupledFiles.find((f) => f.path === 'src/weakly.ts');
      expect(weakEntry).toBeUndefined();
    });

    it('includes pairs above the threshold with lower threshold', () => {
      const { store: testStore } = setupTestStore();
      store = testStore;
      const analyzer = new LogicalCouplingAnalyzer(store);

      // With 50% threshold, coupled file should still be included (71%)
      const result = analyzer.analyze({ file: 'src/main.ts', coOccurrenceThreshold: 0.50 });

      const coupledEntry = result.coupledFiles.find((f) => f.path === 'src/coupled.ts');
      expect(coupledEntry).toBeDefined();
    });

    it('does not include files that never share commits', () => {
      const { store: testStore } = setupTestStore();
      store = testStore;
      const analyzer = new LogicalCouplingAnalyzer(store);

      const result = analyzer.analyze({ file: 'src/main.ts', coOccurrenceThreshold: 0.50 });

      const unrelatedEntry = result.coupledFiles.find((f) => f.path === 'src/unrelated.ts');
      expect(unrelatedEntry).toBeUndefined();
    });
  });

  describe('result ordering and cap', () => {
    it('orders results by co-occurrence percentage descending', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      // Create a target file and multiple coupled files with different ratios
      const target = store.createFile({ current_path: 'src/target.ts' });
      const fileA = store.createFile({ current_path: 'src/a.ts' });
      const fileB = store.createFile({ current_path: 'src/b.ts' });
      const fileC = store.createFile({ current_path: 'src/c.ts' });

      // 3 commits: all shared with A, B, C
      for (let i = 1; i <= 3; i++) {
        const commit = store.createCommit({
          sha: `all-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i),
          message: `all shared ${i}`,
        });
        store.createCommitFile({ commit_id: commit.id, file_id: target.id });
        store.createCommitFile({ commit_id: commit.id, file_id: fileA.id });
        store.createCommitFile({ commit_id: commit.id, file_id: fileB.id });
        store.createCommitFile({ commit_id: commit.id, file_id: fileC.id });
      }

      // 1 extra commit only for B (lowers B's ratio)
      const extraB = store.createCommit({
        sha: 'extra-b',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(4),
        message: 'extra b',
      });
      store.createCommitFile({ commit_id: extraB.id, file_id: fileB.id });

      // 2 extra commits only for C (lowers C's ratio more)
      for (let i = 1; i <= 2; i++) {
        const extraC = store.createCommit({
          sha: `extra-c-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(4 + i),
          message: `extra c ${i}`,
        });
        store.createCommitFile({ commit_id: extraC.id, file_id: fileC.id });
      }

      const result = analyzer.analyze({ file: 'src/target.ts', coOccurrenceThreshold: 0.50 });

      // A: 3/3 = 100%, B: 3/4 = 75%, C: 3/5 = 60%
      expect(result.coupledFiles.length).toBe(3);
      expect(result.coupledFiles[0].path).toBe('src/a.ts');
      expect(result.coupledFiles[1].path).toBe('src/b.ts');
      expect(result.coupledFiles[2].path).toBe('src/c.ts');
      expect(result.coupledFiles[0].coOccurrencePercentage).toBe(100);
      expect(result.coupledFiles[1].coOccurrencePercentage).toBe(75);
      expect(result.coupledFiles[2].coOccurrencePercentage).toBe(60);
    });

    it('caps results at 20 entries', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const target = store.createFile({ current_path: 'src/target.ts' });

      // Create 25 coupled files. Each file shares ALL commits with target
      // so co-occurrence is 100% for each pair.
      const otherFiles: number[] = [];
      for (let i = 0; i < 25; i++) {
        const otherFile = store.createFile({ current_path: `src/file-${i}.ts` });
        otherFiles.push(otherFile.id);
      }

      // Create a single commit that modifies target and all 25 other files
      const commit = store.createCommit({
        sha: 'shared-all',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'shared all',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: target.id });
      for (const fileId of otherFiles) {
        store.createCommitFile({ commit_id: commit.id, file_id: fileId });
      }

      const result = analyzer.analyze({ file: 'src/target.ts', coOccurrenceThreshold: 0.50 });

      expect(result.coupledFiles.length).toBe(20);
    });
  });

  describe('recent shared commits', () => {
    it('includes up to 3 most recent shared commits per coupling', () => {
      const { store: testStore } = setupTestStore();
      store = testStore;
      const analyzer = new LogicalCouplingAnalyzer(store);

      const result = analyzer.analyze({ file: 'src/main.ts', coOccurrenceThreshold: 0.50 });

      const coupledEntry = result.coupledFiles.find((f) => f.path === 'src/coupled.ts');
      expect(coupledEntry).toBeDefined();
      expect(coupledEntry!.recentSharedCommits.length).toBe(3);

      // Verify they are the most recent (shared-1, shared-2, shared-3)
      expect(coupledEntry!.recentSharedCommits[0].sha).toBe('shared-1');
      expect(coupledEntry!.recentSharedCommits[1].sha).toBe('shared-2');
      expect(coupledEntry!.recentSharedCommits[2].sha).toBe('shared-3');
    });

    it('includes all shared commits when fewer than 3 exist', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const target = store.createFile({ current_path: 'src/target.ts' });
      const other = store.createFile({ current_path: 'src/other.ts' });

      // Only 2 shared commits
      for (let i = 1; i <= 2; i++) {
        const commit = store.createCommit({
          sha: `shared-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i),
          message: `shared ${i}`,
        });
        store.createCommitFile({ commit_id: commit.id, file_id: target.id });
        store.createCommitFile({ commit_id: commit.id, file_id: other.id });
      }

      const result = analyzer.analyze({ file: 'src/target.ts', coOccurrenceThreshold: 0.50 });

      const entry = result.coupledFiles.find((f) => f.path === 'src/other.ts');
      expect(entry).toBeDefined();
      expect(entry!.recentSharedCommits.length).toBe(2);
    });

    it('includes sha, date, and message for each recent shared commit', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const target = store.createFile({ current_path: 'src/target.ts' });
      const other = store.createFile({ current_path: 'src/other.ts' });

      const commitDate = monthsAgo(1);
      const commit = store.createCommit({
        sha: 'abc123',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: commitDate,
        message: 'fix: resolve coupling issue',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: target.id });
      store.createCommitFile({ commit_id: commit.id, file_id: other.id });

      const result = analyzer.analyze({ file: 'src/target.ts', coOccurrenceThreshold: 0.50 });

      const entry = result.coupledFiles.find((f) => f.path === 'src/other.ts');
      expect(entry).toBeDefined();
      expect(entry!.recentSharedCommits[0]).toEqual({
        sha: 'abc123',
        date: commitDate,
        message: 'fix: resolve coupling issue',
      });
    });
  });

  describe('analysis period filtering', () => {
    it('only considers commits within the analysis period', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const target = store.createFile({ current_path: 'src/target.ts' });
      const other = store.createFile({ current_path: 'src/other.ts' });

      // 1 shared commit within 6-month period
      const recentCommit = store.createCommit({
        sha: 'recent-shared',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(2),
        message: 'recent shared',
      });
      store.createCommitFile({ commit_id: recentCommit.id, file_id: target.id });
      store.createCommitFile({ commit_id: recentCommit.id, file_id: other.id });

      // 5 shared commits outside 6-month period (should be excluded)
      for (let i = 1; i <= 5; i++) {
        const oldCommit = store.createCommit({
          sha: `old-shared-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(12 + i),
          message: `old shared ${i}`,
        });
        store.createCommitFile({ commit_id: oldCommit.id, file_id: target.id });
        store.createCommitFile({ commit_id: oldCommit.id, file_id: other.id });
      }

      // With 6-month period, only 1 shared commit should count
      const result = analyzer.analyze({
        file: 'src/target.ts',
        coOccurrenceThreshold: 0.50,
        analysisPeriodMonths: 6,
      });

      const entry = result.coupledFiles.find((f) => f.path === 'src/other.ts');
      if (entry) {
        expect(entry.sharedCommits).toBe(1);
      }
    });

    it('returns analysis period in the result', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const result = analyzer.analyze({ file: 'src/nonexistent.ts', analysisPeriodMonths: 6 });

      expect(result.analysisperiod).toBeDefined();
      expect(result.analysisperiod.start).toBeDefined();
      expect(result.analysisperiod.end).toBeDefined();

      const start = new Date(result.analysisperiod.start);
      const end = new Date(result.analysisperiod.end);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    });
  });

  describe('no couplings found', () => {
    it('returns empty coupledFiles when file is not in the store', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const result = analyzer.analyze({ file: 'src/nonexistent.ts' });

      expect(result.file).toBe('src/nonexistent.ts');
      expect(result.coupledFiles).toEqual([]);
    });

    it('returns empty coupledFiles when file has no commits in period', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      store.createFile({ current_path: 'src/lonely.ts' });

      const result = analyzer.analyze({ file: 'src/lonely.ts' });

      expect(result.coupledFiles).toEqual([]);
    });

    it('returns empty coupledFiles when no pairs exceed threshold', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const target = store.createFile({ current_path: 'src/target.ts' });
      const other = store.createFile({ current_path: 'src/other.ts' });

      // 1 shared commit
      const shared = store.createCommit({
        sha: 'shared-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'shared',
      });
      store.createCommitFile({ commit_id: shared.id, file_id: target.id });
      store.createCommitFile({ commit_id: shared.id, file_id: other.id });

      // 5 solo commits for target (lowers ratio to 1/6 ≈ 17%)
      for (let i = 1; i <= 5; i++) {
        const solo = store.createCommit({
          sha: `solo-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i + 1),
          message: `solo ${i}`,
        });
        store.createCommitFile({ commit_id: solo.id, file_id: target.id });
      }

      const result = analyzer.analyze({ file: 'src/target.ts' });

      expect(result.coupledFiles).toEqual([]);
    });
  });

  describe('result structure', () => {
    it('returns the target file path in the result', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const result = analyzer.analyze({ file: 'src/my-file.ts' });

      expect(result.file).toBe('src/my-file.ts');
    });

    it('uses default threshold of 70% when not specified', () => {
      store = new SqliteStore(':memory:');
      const analyzer = new LogicalCouplingAnalyzer(store);

      const target = store.createFile({ current_path: 'src/target.ts' });
      const other = store.createFile({ current_path: 'src/other.ts' });

      // Create scenario where co-occurrence is 60% (below default 70%)
      // 3 shared commits, 2 solo for target → 3/5 = 60%
      for (let i = 1; i <= 3; i++) {
        const commit = store.createCommit({
          sha: `shared-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i),
          message: `shared ${i}`,
        });
        store.createCommitFile({ commit_id: commit.id, file_id: target.id });
        store.createCommitFile({ commit_id: commit.id, file_id: other.id });
      }

      for (let i = 1; i <= 2; i++) {
        const solo = store.createCommit({
          sha: `solo-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i + 3),
          message: `solo ${i}`,
        });
        store.createCommitFile({ commit_id: solo.id, file_id: target.id });
      }

      // Default threshold is 70%, so 60% should be excluded
      const result = analyzer.analyze({ file: 'src/target.ts' });
      expect(result.coupledFiles).toEqual([]);

      // With 50% threshold, it should be included
      const resultLow = analyzer.analyze({ file: 'src/target.ts', coOccurrenceThreshold: 0.50 });
      expect(resultLow.coupledFiles.length).toBe(1);
    });
  });
});

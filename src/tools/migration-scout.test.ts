import { describe, it, expect, afterEach } from 'vitest';
import { MigrationScout } from './migration-scout.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import type { GitAdapter } from '../types/index.js';

/**
 * Helper to create a date N months ago from now.
 */
function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/**
 * Creates a mock GitAdapter (not used directly in classification logic
 * but required as a dependency).
 */
function createMockGitAdapter(): GitAdapter {
  return {
    blame: async () => [],
    log: async () => [],
    logFollow: async () => [],
    show: async () => ({
      sha: '',
      authorName: '',
      authorEmail: '',
      date: '',
      message: '',
      linesAdded: 0,
      linesDeleted: 0,
      filesChanged: [],
    }),
    getRepoRoot: async () => '/repo',
    getGitDir: async () => '/repo/.git',
    isValidRepo: async () => true,
    diffStat: async () => [],
    numstat: async () => [],
    getNewCommits: async () => [],
  };
}

describe('MigrationScout', () => {
  let store: SqliteStore;

  afterEach(() => {
    if (store) {
      store.close();
    }
  });

  describe('file classification', () => {
    it('classifies files with no modifications in 24 months as do-not-migrate', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // Create a file with only old commits (> 24 months ago)
      const file = store.createFile({ current_path: 'src/module/dead.ts' });
      const commit = store.createCommit({
        sha: 'old-commit-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(30),
        message: 'initial implementation',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      // Add a recent commit to ensure history confidence is high
      const recentFile = store.createFile({ current_path: 'src/module/recent.ts' });
      const recentCommit = store.createCommit({
        sha: 'recent-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'recent change',
      });
      store.createCommitFile({ commit_id: recentCommit.id, file_id: recentFile.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.doNotMigrate.length).toBe(1);
      expect(report.categories.doNotMigrate[0].path).toBe('src/module/dead.ts');
      expect(report.categories.doNotMigrate[0].category).toBe('do-not-migrate');
      expect(report.categories.doNotMigrate[0].reason).toContain('Dead code');
    });

    it('classifies files with logical couplings as investigate', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // Create two files that are always modified together (100% co-occurrence)
      const fileA = store.createFile({ current_path: 'src/module/coupled-a.ts' });
      const fileB = store.createFile({ current_path: 'src/module/coupled-b.ts' });

      for (let i = 1; i <= 5; i++) {
        const commit = store.createCommit({
          sha: `coupled-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i),
          message: `feature work ${i}`,
        });
        store.createCommitFile({ commit_id: commit.id, file_id: fileA.id });
        store.createCommitFile({ commit_id: commit.id, file_id: fileB.id });
      }

      const report = await scout.analyze({ path: 'src/module/' });

      // Both files should be classified as "investigate" due to coupling
      const investigateA = report.categories.requiresInvestigation.find(
        (f) => f.path === 'src/module/coupled-a.ts'
      );
      expect(investigateA).toBeDefined();
      expect(investigateA!.category).toBe('investigate');
      expect(investigateA!.logicalDependencies).toContain('src/module/coupled-b.ts');
    });

    it('classifies files with security patches as investigate', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/patched.ts' });
      const commit = store.createCommit({
        sha: 'fix-commit-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(2),
        message: 'fix: resolve security vulnerability in auth',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      const entry = report.categories.requiresInvestigation.find(
        (f) => f.path === 'src/module/patched.ts'
      );
      expect(entry).toBeDefined();
      expect(entry!.category).toBe('investigate');
      expect(entry!.securityPatches).toContain('fix-commit-1');
      expect(entry!.riskScore).toBeDefined();
    });

    it('classifies files without issues as safe', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/clean.ts' });
      const commit = store.createCommit({
        sha: 'clean-commit-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(2),
        message: 'add new feature',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.safeToMigrate.length).toBe(1);
      expect(report.categories.safeToMigrate[0].path).toBe('src/module/clean.ts');
      expect(report.categories.safeToMigrate[0].category).toBe('safe');
    });

    it('classifies files with no commits as do-not-migrate', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      store.createFile({ current_path: 'src/module/orphan.ts' });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.doNotMigrate.length).toBe(1);
      expect(report.categories.doNotMigrate[0].path).toBe('src/module/orphan.ts');
    });
  });

  describe('investigate file details', () => {
    it('includes logical dependencies for investigate files', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const fileA = store.createFile({ current_path: 'src/module/a.ts' });
      const fileB = store.createFile({ current_path: 'src/module/b.ts' });

      // 100% co-occurrence
      for (let i = 1; i <= 3; i++) {
        const commit = store.createCommit({
          sha: `shared-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i),
          message: `work ${i}`,
        });
        store.createCommitFile({ commit_id: commit.id, file_id: fileA.id });
        store.createCommitFile({ commit_id: commit.id, file_id: fileB.id });
      }

      const report = await scout.analyze({ path: 'src/module/' });

      const entryA = report.categories.requiresInvestigation.find(
        (f) => f.path === 'src/module/a.ts'
      );
      expect(entryA).toBeDefined();
      expect(entryA!.logicalDependencies).toContain('src/module/b.ts');
    });

    it('includes security patch SHAs for investigate files', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/secure.ts' });

      const fixCommit = store.createCommit({
        sha: 'sec-fix-abc',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(3),
        message: 'fix: patch critical bug in validation',
      });
      store.createCommitFile({ commit_id: fixCommit.id, file_id: file.id });

      const normalCommit = store.createCommit({
        sha: 'normal-def',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'refactor: improve readability',
      });
      store.createCommitFile({ commit_id: normalCommit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      const entry = report.categories.requiresInvestigation.find(
        (f) => f.path === 'src/module/secure.ts'
      );
      expect(entry).toBeDefined();
      expect(entry!.securityPatches).toContain('sec-fix-abc');
      expect(entry!.securityPatches).not.toContain('normal-def');
    });

    it('calculates risk score based on churn and age', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/risky.ts' });

      // Multiple contributors and commits over a long period
      for (let i = 1; i <= 5; i++) {
        const commit = store.createCommit({
          sha: `risky-${i}`,
          author_name: `Dev${i}`,
          author_email: `dev${i}@test.com`,
          authored_date: monthsAgo(i * 6),
          message: i === 1 ? 'fix: critical bug' : `feature ${i}`,
        });
        store.createCommitFile({ commit_id: commit.id, file_id: file.id });
      }

      const report = await scout.analyze({ path: 'src/module/' });

      const entry = report.categories.requiresInvestigation.find(
        (f) => f.path === 'src/module/risky.ts'
      );
      expect(entry).toBeDefined();
      expect(entry!.riskScore).toBeGreaterThan(0);
    });
  });

  describe('executive summary', () => {
    it('includes correct total file count', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // Create 3 files in the module
      for (let i = 1; i <= 3; i++) {
        const file = store.createFile({ current_path: `src/module/file${i}.ts` });
        const commit = store.createCommit({
          sha: `commit-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i),
          message: `add file ${i}`,
        });
        store.createCommitFile({ commit_id: commit.id, file_id: file.id });
      }

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.executiveSummary.totalAnalyzed).toBe(3);
      expect(report.totalFiles).toBe(3);
    });

    it('distribution matches actual category counts', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // 1 safe file
      const safeFile = store.createFile({ current_path: 'src/module/safe.ts' });
      const safeCommit = store.createCommit({
        sha: 'safe-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(2),
        message: 'add feature',
      });
      store.createCommitFile({ commit_id: safeCommit.id, file_id: safeFile.id });

      // 1 investigate file (has fix keyword)
      const invFile = store.createFile({ current_path: 'src/module/investigate.ts' });
      const invCommit = store.createCommit({
        sha: 'inv-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'fix: resolve edge case',
      });
      store.createCommitFile({ commit_id: invCommit.id, file_id: invFile.id });

      // 1 dead file
      const deadFile = store.createFile({ current_path: 'src/module/dead.ts' });
      const deadCommit = store.createCommit({
        sha: 'dead-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(30),
        message: 'initial',
      });
      store.createCommitFile({ commit_id: deadCommit.id, file_id: deadFile.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.executiveSummary.distribution.safe).toBe(1);
      expect(report.executiveSummary.distribution.investigate).toBe(1);
      expect(report.executiveSummary.distribution.doNotMigrate).toBe(1);
      expect(
        report.executiveSummary.distribution.safe +
          report.executiveSummary.distribution.investigate +
          report.executiveSummary.distribution.doNotMigrate
      ).toBe(report.executiveSummary.totalAnalyzed);
    });

    it('returns top 5 risk files ordered by risk score descending', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // Create 7 files with security patches (varying risk)
      for (let i = 1; i <= 7; i++) {
        const file = store.createFile({ current_path: `src/module/risk${i}.ts` });
        // More contributors = higher churn = higher risk
        for (let j = 1; j <= i; j++) {
          const commit = store.createCommit({
            sha: `risk-${i}-${j}`,
            author_name: `Dev${j}`,
            author_email: `dev${j}@test.com`,
            authored_date: monthsAgo(j),
            message: 'fix: security patch',
          });
          store.createCommitFile({ commit_id: commit.id, file_id: file.id });
        }
      }

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.executiveSummary.topRiskFiles.length).toBeLessThanOrEqual(5);
      // Verify descending order
      for (let i = 1; i < report.executiveSummary.topRiskFiles.length; i++) {
        expect(report.executiveSummary.topRiskFiles[i - 1].riskScore).toBeGreaterThanOrEqual(
          report.executiveSummary.topRiskFiles[i].riskScore
        );
      }
    });

    it('returns fewer than 5 risk files when fewer exist', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // Create 2 investigate files
      for (let i = 1; i <= 2; i++) {
        const file = store.createFile({ current_path: `src/module/risk${i}.ts` });
        const commit = store.createCommit({
          sha: `risk-${i}`,
          author_name: 'Dev',
          author_email: 'dev@test.com',
          authored_date: monthsAgo(i),
          message: 'fix: bug',
        });
        store.createCommitFile({ commit_id: commit.id, file_id: file.id });
      }

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.executiveSummary.topRiskFiles.length).toBe(2);
    });

    it('top risk files include justification', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/justified.ts' });
      const commit = store.createCommit({
        sha: 'just-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'fix: critical vulnerability',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.executiveSummary.topRiskFiles.length).toBeGreaterThan(0);
      expect(report.executiveSummary.topRiskFiles[0].justification).toBeDefined();
      expect(report.executiveSummary.topRiskFiles[0].justification.length).toBeGreaterThan(0);
    });
  });

  describe('history confidence', () => {
    it('returns limited confidence when history is less than 6 months', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/new.ts' });
      const commit = store.createCommit({
        sha: 'new-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(2),
        message: 'initial',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.historyConfidence).toBe('limited');
    });

    it('returns high confidence when history spans 6+ months', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/old.ts' });

      // Create commits spanning 8 months
      const oldCommit = store.createCommit({
        sha: 'old-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(8),
        message: 'initial',
      });
      store.createCommitFile({ commit_id: oldCommit.id, file_id: file.id });

      const newCommit = store.createCommit({
        sha: 'new-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'update',
      });
      store.createCommitFile({ commit_id: newCommit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.historyConfidence).toBe('high');
    });

    it('returns limited confidence when no commits exist', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      store.createFile({ current_path: 'src/module/empty.ts' });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.historyConfidence).toBe('limited');
    });
  });

  describe('module path filtering', () => {
    it('only analyzes files within the specified module path', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // File inside module
      const insideFile = store.createFile({ current_path: 'src/module/inside.ts' });
      const insideCommit = store.createCommit({
        sha: 'inside-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'inside work',
      });
      store.createCommitFile({ commit_id: insideCommit.id, file_id: insideFile.id });

      // File outside module
      const outsideFile = store.createFile({ current_path: 'src/other/outside.ts' });
      const outsideCommit = store.createCommit({
        sha: 'outside-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'outside work',
      });
      store.createCommitFile({ commit_id: outsideCommit.id, file_id: outsideFile.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.totalFiles).toBe(1);
      expect(report.categories.safeToMigrate[0].path).toBe('src/module/inside.ts');
    });

    it('returns the module path in the report', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const report = await scout.analyze({ path: 'src/legacy/' });

      expect(report.modulePath).toBe('src/legacy/');
    });
  });

  describe('security keyword detection', () => {
    it('detects "fix" keyword in commit messages', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/a.ts' });
      const commit = store.createCommit({
        sha: 'fix-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'fix: null pointer exception',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.requiresInvestigation.length).toBe(1);
    });

    it('detects "bug" keyword in commit messages', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/b.ts' });
      const commit = store.createCommit({
        sha: 'bug-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'resolve bug in parser',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.requiresInvestigation.length).toBe(1);
    });

    it('detects "security" keyword in commit messages', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/c.ts' });
      const commit = store.createCommit({
        sha: 'sec-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'security: update auth tokens',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.requiresInvestigation.length).toBe(1);
    });

    it('detects "edge case" keyword in commit messages', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/d.ts' });
      const commit = store.createCommit({
        sha: 'edge-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'handle edge case for empty arrays',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.requiresInvestigation.length).toBe(1);
    });

    it('is case-insensitive for keyword detection', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const file = store.createFile({ current_path: 'src/module/e.ts' });
      const commit = store.createCommit({
        sha: 'case-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(1),
        message: 'FIX: Critical BUG in Security module',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      expect(report.categories.requiresInvestigation.length).toBe(1);
    });
  });

  describe('dead code detection priority', () => {
    it('dead code classification takes priority over security patches', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      // File with a security fix but no modifications in 24+ months
      const file = store.createFile({ current_path: 'src/module/old-fix.ts' });
      const commit = store.createCommit({
        sha: 'old-fix-1',
        author_name: 'Dev',
        author_email: 'dev@test.com',
        authored_date: monthsAgo(30),
        message: 'fix: critical security vulnerability',
      });
      store.createCommitFile({ commit_id: commit.id, file_id: file.id });

      const report = await scout.analyze({ path: 'src/module/' });

      // Should be do-not-migrate because dead code check comes first
      expect(report.categories.doNotMigrate.length).toBe(1);
      expect(report.categories.requiresInvestigation.length).toBe(0);
    });
  });

  describe('empty module', () => {
    it('returns empty report for module with no files', async () => {
      store = new SqliteStore(':memory:');
      const scout = new MigrationScout(store, createMockGitAdapter());

      const report = await scout.analyze({ path: 'src/nonexistent/' });

      expect(report.totalFiles).toBe(0);
      expect(report.categories.safeToMigrate).toEqual([]);
      expect(report.categories.requiresInvestigation).toEqual([]);
      expect(report.categories.doNotMigrate).toEqual([]);
      expect(report.executiveSummary.totalAnalyzed).toBe(0);
    });
  });
});

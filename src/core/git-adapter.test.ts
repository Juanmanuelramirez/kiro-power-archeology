import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitCliAdapter } from './git-adapter.js';

// Mock child_process.execFile
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';

const mockExecFile = vi.mocked(execFile);

function setupMockExec(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: any, _args: any, _opts: any, callback?: any) => {
      if (typeof _opts === 'function') {
        callback = _opts;
      }
      // promisify wraps this, so we need to call the callback
      if (callback) {
        callback(null, { stdout, stderr: '' });
      }
      return {} as any;
    }
  );
}

function setupMockExecError(error: Error) {
  mockExecFile.mockImplementation(
    (_cmd: any, _args: any, _opts: any, callback?: any) => {
      if (typeof _opts === 'function') {
        callback = _opts;
      }
      if (callback) {
        callback(error, { stdout: '', stderr: '' });
      }
      return {} as any;
    }
  );
}

describe('GitCliAdapter', () => {
  let adapter: GitCliAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitCliAdapter('/test/repo');
  });

  describe('blame', () => {
    it('should parse porcelain blame output correctly', async () => {
      const porcelainOutput = [
        'abc1234567890123456789012345678901234567 10 10 1',
        'author John Doe',
        'author-mail <john@example.com>',
        'author-time 1700000000',
        'author-tz +0000',
        'committer John Doe',
        'committer-mail <john@example.com>',
        'committer-time 1700000000',
        'committer-tz +0000',
        'summary Fix the bug',
        'filename src/main.ts',
        '\tconst x = 42;',
      ].join('\n');

      setupMockExec(porcelainOutput);

      const result = await adapter.blame('src/main.ts', 10, 10);

      expect(result).toHaveLength(1);
      expect(result[0].commitSha).toBe('abc1234567890123456789012345678901234567');
      expect(result[0].author).toBe('John Doe');
      expect(result[0].authorEmail).toBe('john@example.com');
      expect(result[0].line).toBe(10);
      expect(result[0].content).toBe('const x = 42;');
    });

    it('should parse multiple blame entries', async () => {
      const porcelainOutput = [
        'aaaa234567890123456789012345678901234567 1 1 1',
        'author Alice',
        'author-mail <alice@example.com>',
        'author-time 1700000000',
        'filename file.ts',
        '\tline one',
        'bbbb234567890123456789012345678901234567 2 2 1',
        'author Bob',
        'author-mail <bob@example.com>',
        'author-time 1700001000',
        'filename file.ts',
        '\tline two',
      ].join('\n');

      setupMockExec(porcelainOutput);

      const result = await adapter.blame('file.ts', 1, 2);

      expect(result).toHaveLength(2);
      expect(result[0].author).toBe('Alice');
      expect(result[0].line).toBe(1);
      expect(result[1].author).toBe('Bob');
      expect(result[1].line).toBe(2);
    });

    it('should pass correct arguments to git blame', async () => {
      setupMockExec('');

      await adapter.blame('src/file.ts', 5, 15);

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['blame', '-L', '5,15', '--porcelain', '--', 'src/file.ts'],
        expect.objectContaining({ cwd: '/test/repo' }),
        expect.any(Function)
      );
    });
  });

  describe('log', () => {
    it('should parse log output correctly', async () => {
      const logOutput = [
        'abc123def456789012345678901234567890abcd',
        'John Doe',
        'john@example.com',
        '2024-01-15T10:30:00+00:00',
        'Fix critical bug in parser',
        '---END---',
        'def456abc789012345678901234567890abcd1234',
        'Jane Smith',
        'jane@example.com',
        '2024-01-14T09:00:00+00:00',
        'Add new feature',
        '---END---',
      ].join('\n');

      setupMockExec(logOutput);

      const result = await adapter.log({});

      expect(result).toHaveLength(2);
      expect(result[0].sha).toBe('abc123def456789012345678901234567890abcd');
      expect(result[0].authorName).toBe('John Doe');
      expect(result[0].authorEmail).toBe('john@example.com');
      expect(result[0].date).toBe('2024-01-15T10:30:00+00:00');
      expect(result[0].message).toBe('Fix critical bug in parser');
      expect(result[1].sha).toBe('def456abc789012345678901234567890abcd1234');
    });

    it('should pass --since option', async () => {
      setupMockExec('');

      await adapter.log({ since: '2024-01-01' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--since=2024-01-01']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should pass --until option', async () => {
      setupMockExec('');

      await adapter.log({ until: '2024-12-31' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--until=2024-12-31']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should pass --author option', async () => {
      setupMockExec('');

      await adapter.log({ author: 'john@example.com' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--author=john@example.com']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should pass --all flag', async () => {
      setupMockExec('');

      await adapter.log({ all: true });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--all']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should pass maxCount option', async () => {
      setupMockExec('');

      await adapter.log({ maxCount: 50 });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['-n', '50']),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('logFollow', () => {
    it('should pass --follow flag with file path', async () => {
      setupMockExec('');

      await adapter.logFollow('src/old-name.ts');

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--follow', '--', 'src/old-name.ts']),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('show', () => {
    it('should parse show output with stat', async () => {
      const showOutput = [
        'abc123def456789012345678901234567890abcd',
        'John Doe',
        'john@example.com',
        '2024-01-15T10:30:00+00:00',
        'Fix critical bug in parser',
        '',
        'This commit fixes the parser issue that caused crashes.',
        '---MSG_END---',
        ' src/parser.ts | 15 +++++++++------',
        ' src/utils.ts  |  3 ++-',
        ' 2 files changed, 10 insertions(+), 6 deletions(-)',
      ].join('\n');

      setupMockExec(showOutput);

      const result = await adapter.show('abc123');

      expect(result.sha).toBe('abc123def456789012345678901234567890abcd');
      expect(result.authorName).toBe('John Doe');
      expect(result.authorEmail).toBe('john@example.com');
      expect(result.date).toBe('2024-01-15T10:30:00+00:00');
      expect(result.message).toContain('Fix critical bug in parser');
      expect(result.linesAdded).toBe(10);
      expect(result.linesDeleted).toBe(6);
      expect(result.filesChanged).toContain('src/parser.ts');
      expect(result.filesChanged).toContain('src/utils.ts');
    });
  });

  describe('getRepoRoot', () => {
    it('should return trimmed repo root path', async () => {
      setupMockExec('/home/user/project\n');

      const result = await adapter.getRepoRoot();

      expect(result).toBe('/home/user/project');
    });
  });

  describe('getGitDir', () => {
    it('should return trimmed git dir path', async () => {
      setupMockExec('.git\n');

      const result = await adapter.getGitDir();

      expect(result).toBe('.git');
    });
  });

  describe('isValidRepo', () => {
    it('should return true for valid repo', async () => {
      setupMockExec('true\n');

      const result = await adapter.isValidRepo();

      expect(result).toBe(true);
    });

    it('should return false when git command fails', async () => {
      setupMockExecError(new Error('not a git repository'));

      const result = await adapter.isValidRepo();

      expect(result).toBe(false);
    });
  });

  describe('numstat', () => {
    it('should parse numstat output correctly', async () => {
      const numstatOutput = [
        '10\t5\tsrc/parser.ts',
        '3\t1\tsrc/utils.ts',
        '-\t-\timage.png',
      ].join('\n');

      setupMockExec(numstatOutput);

      const result = await adapter.numstat('abc123');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ added: 10, deleted: 5, file: 'src/parser.ts' });
      expect(result[1]).toEqual({ added: 3, deleted: 1, file: 'src/utils.ts' });
      expect(result[2]).toEqual({ added: 0, deleted: 0, file: 'image.png' });
    });
  });

  describe('diffStat', () => {
    it('should parse diff stat output correctly', async () => {
      const diffStatOutput = [
        ' src/parser.ts | 15 +++++++++------',
        ' src/utils.ts  |  3 ++-',
        ' 2 files changed, 10 insertions(+), 6 deletions(-)',
      ].join('\n');

      setupMockExec(diffStatOutput);

      const result = await adapter.diffStat('abc123');

      expect(result).toHaveLength(2);
      expect(result[0].file).toBe('src/parser.ts');
      expect(result[0].insertions).toBe(9);
      expect(result[0].deletions).toBe(6);
      expect(result[1].file).toBe('src/utils.ts');
    });
  });

  describe('getNewCommits', () => {
    it('should pass sinceCommit..HEAD range when sinceCommit is provided', async () => {
      setupMockExec('');

      await adapter.getNewCommits('abc123');

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['abc123..HEAD']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should not pass range when sinceCommit is null', async () => {
      setupMockExec('');

      await adapter.getNewCommits(null);

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).not.toContain(expect.stringContaining('..HEAD'));
    });
  });

  describe('timeout support', () => {
    it('should use default timeout of 30 seconds', async () => {
      setupMockExec('');

      await adapter.getRepoRoot();

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.any(Array),
        expect.objectContaining({ timeout: 30_000 }),
        expect.any(Function)
      );
    });

    it('should use custom timeout when provided', async () => {
      const customAdapter = new GitCliAdapter('/test/repo', 5000);
      setupMockExec('');

      await customAdapter.getRepoRoot();

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.any(Array),
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function)
      );
    });
  });
});

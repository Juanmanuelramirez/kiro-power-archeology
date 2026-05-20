import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  GitAdapter,
  BlameEntry,
  CommitEntry,
  CommitDetail,
  GitLogOptions,
  FileDiffStat,
  FileNumStat,
} from '../types/index.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;

export class GitCliAdapter implements GitAdapter {
  private readonly repoPath: string;
  private readonly timeoutMs: number;

  constructor(repoPath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.repoPath = repoPath;
    this.timeoutMs = timeoutMs;
  }

  private async exec(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.repoPath,
      timeout: this.timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout;
  }

  async blame(file: string, startLine: number, endLine: number): Promise<BlameEntry[]> {
    const output = await this.exec([
      'blame',
      '-L',
      `${startLine},${endLine}`,
      '--porcelain',
      '--',
      file,
    ]);

    return parseBlameOutput(output);
  }

  async log(options: GitLogOptions): Promise<CommitEntry[]> {
    const args = ['log', '--format=%H%n%an%n%ae%n%aI%n%s%n---END---'];

    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    if (options.author) {
      args.push(`--author=${options.author}`);
    }
    if (options.all) {
      args.push('--all');
    }
    if (options.maxCount !== undefined) {
      args.push(`-n`, `${options.maxCount}`);
    }
    if (options.format) {
      // Override the default format if a custom one is provided
      args[1] = `--format=${options.format}`;
    }

    const output = await this.exec(args);
    return parseLogOutput(output);
  }

  async logFollow(file: string): Promise<CommitEntry[]> {
    const output = await this.exec([
      'log',
      '--follow',
      '--format=%H%n%an%n%ae%n%aI%n%s%n---END---',
      '--',
      file,
    ]);

    return parseLogOutput(output);
  }

  async show(commitSha: string): Promise<CommitDetail> {
    const output = await this.exec([
      'show',
      '--stat',
      '--format=%H%n%an%n%ae%n%aI%n%B%n---MSG_END---',
      commitSha,
    ]);

    return parseShowOutput(output);
  }

  async getRepoRoot(): Promise<string> {
    const output = await this.exec(['rev-parse', '--show-toplevel']);
    return output.trim();
  }

  async getGitDir(): Promise<string> {
    const output = await this.exec(['rev-parse', '--git-dir']);
    return output.trim();
  }

  async isValidRepo(): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  async diffStat(commitSha: string): Promise<FileDiffStat[]> {
    const output = await this.exec([
      'diff',
      '--stat',
      `${commitSha}~1`,
      commitSha,
    ]);

    return parseDiffStatOutput(output);
  }

  async numstat(commitSha: string): Promise<FileNumStat[]> {
    const output = await this.exec([
      'diff',
      '--numstat',
      `${commitSha}~1`,
      commitSha,
    ]);

    return parseNumstatOutput(output);
  }

  async getNewCommits(sinceCommit: string | null): Promise<CommitEntry[]> {
    const args = ['log', '--format=%H%n%an%n%ae%n%aI%n%s%n---END---'];

    if (sinceCommit) {
      args.push(`${sinceCommit}..HEAD`);
    }

    const output = await this.exec(args);
    return parseLogOutput(output);
  }
}


// === Parsing Functions ===

function parseBlameOutput(output: string): BlameEntry[] {
  const entries: BlameEntry[] = [];
  const lines = output.split('\n');

  let i = 0;
  while (i < lines.length) {
    const headerLine = lines[i];
    if (!headerLine || headerLine.trim() === '') {
      i++;
      continue;
    }

    // Header line format: <sha> <orig-line> <final-line> [<num-lines>]
    const headerMatch = headerLine.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
    if (!headerMatch) {
      i++;
      continue;
    }

    const commitSha = headerMatch[1];
    const finalLine = parseInt(headerMatch[3], 10);

    let author = '';
    let authorEmail = '';
    let authorDate = '';
    let content = '';

    i++;

    // Parse metadata lines until we hit the content line (starts with \t)
    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('\t')) {
        content = line.substring(1);
        i++;
        break;
      }

      if (line.startsWith('author ')) {
        author = line.substring('author '.length);
      } else if (line.startsWith('author-mail ')) {
        authorEmail = line.substring('author-mail '.length).replace(/[<>]/g, '');
      } else if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.substring('author-time '.length), 10);
        authorDate = new Date(timestamp * 1000).toISOString();
      }

      i++;
    }

    entries.push({
      commitSha,
      author,
      authorEmail,
      authorDate,
      line: finalLine,
      content,
    });
  }

  return entries;
}

function parseLogOutput(output: string): CommitEntry[] {
  const entries: CommitEntry[] = [];
  const blocks = output.split('---END---');

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    if (lines.length < 5) continue;

    entries.push({
      sha: lines[0].trim(),
      authorName: lines[1].trim(),
      authorEmail: lines[2].trim(),
      date: lines[3].trim(),
      message: lines.slice(4).join('\n').trim(),
    });
  }

  return entries;
}

function parseShowOutput(output: string): CommitDetail {
  const msgEndIndex = output.indexOf('---MSG_END---');
  const headerAndMessage = output.substring(0, msgEndIndex);
  const statSection = output.substring(msgEndIndex + '---MSG_END---'.length);

  const headerLines = headerAndMessage.split('\n');
  const sha = headerLines[0].trim();
  const authorName = headerLines[1].trim();
  const authorEmail = headerLines[2].trim();
  const date = headerLines[3].trim();
  const message = headerLines.slice(4).join('\n').trim();

  // Parse stat section for files changed and line counts
  const filesChanged: string[] = [];
  let linesAdded = 0;
  let linesDeleted = 0;

  const statLines = statSection.trim().split('\n');
  for (const line of statLines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Summary line: "X files changed, Y insertions(+), Z deletions(-)"
    const summaryMatch = trimmedLine.match(
      /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
    );
    if (summaryMatch) {
      linesAdded = parseInt(summaryMatch[2] || '0', 10);
      linesDeleted = parseInt(summaryMatch[3] || '0', 10);
      continue;
    }

    // File stat line: " path/to/file | N +++---"
    const fileMatch = trimmedLine.match(/^\s*(.+?)\s+\|\s+\d+/);
    if (fileMatch) {
      filesChanged.push(fileMatch[1].trim());
    }
  }

  return {
    sha,
    authorName,
    authorEmail,
    date,
    message,
    linesAdded,
    linesDeleted,
    filesChanged,
  };
}

function parseDiffStatOutput(output: string): FileDiffStat[] {
  const entries: FileDiffStat[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Summary line — skip it
    if (trimmed.match(/\d+\s+files?\s+changed/)) continue;

    // File stat line: " path/to/file | N +++---"
    const match = trimmed.match(/^\s*(.+?)\s+\|\s+(\d+)\s+(\+*)(-*)/);
    if (match) {
      const file = match[1].trim();
      const insertions = match[3].length;
      const deletions = match[4].length;
      entries.push({ file, insertions, deletions });
    }
  }

  return entries;
}

function parseNumstatOutput(output: string): FileNumStat[] {
  const entries: FileNumStat[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Numstat format: <added>\t<deleted>\t<file>
    const parts = trimmed.split('\t');
    if (parts.length >= 3) {
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
      const file = parts.slice(2).join('\t'); // Handle filenames with tabs (unlikely but safe)
      entries.push({ added, deleted, file });
    }
  }

  return entries;
}

// === Git-Related Types ===

export interface BlameEntry {
  commitSha: string;
  author: string;
  authorEmail: string;
  authorDate: string;
  line: number;
  content: string;
}

export interface CommitEntry {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
}

export interface CommitDetail {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: string[];
}

export interface GitLogOptions {
  since?: string;
  until?: string;
  author?: string;
  all?: boolean;
  format?: string;
  maxCount?: number;
}

export interface FileDiffStat {
  file: string;
  insertions: number;
  deletions: number;
}

export interface FileNumStat {
  file: string;
  added: number;
  deleted: number;
}

// === Analysis Results ===

export interface IntentAnalysisResult {
  file: string;
  lineRange: { start: number; end: number };
  commits: CommitIntent[];
  summary: string;
}

export interface CommitIntent {
  sha: string;
  author: string;
  date: string;
  message: string;
  naturalLanguageSummary: string; // max 500 chars
  pullRequest?: { number: number; title: string };
  discussionSummary?: string; // max 300 chars
  issueRefs: string[];
}

// === Shadow Debt ===

export interface ShadowDebtReport {
  analyzedFiles: number;
  analysisPeriod: { start: string; end: string };
  riskZones: ArchaeologicalRiskZone[];
}

export interface ArchaeologicalRiskZone {
  filePath: string;
  uniqueContributors: number;
  lastDocumentationUpdate: string | null;
  churnScore: number;
  analysisPeriodMonths: number;
}

// === Oracle Chat ===

export interface OracleResponse {
  answer: string;
  references: OracleReference[];
  confidence: 'high' | 'medium' | 'low';
}

export interface OracleReference {
  type: 'commit' | 'pr' | 'file' | 'ticket';
  identifier: string;
  description: string;
}

// === Excavation Card ===

export interface ExcavationCard {
  file: string;
  originalAuthor: string;
  currentMaintainer: string;
  lastMajorRefactor: { date: string; commitSha: string } | null;
  cyclomaticComplexity: number | null;
  fileAge: string;
  fieldsUnavailable: string[];
}

// === Pre-Refactor Safety ===

export interface RefactorSafetyResult {
  safe: boolean;
  warnings: RefactorWarning[];
  analysisCompleted: boolean;
}

export interface RefactorWarning {
  caseId: string;
  description: string;
  commitSha: string;
  prNumber?: number;
  severity: 'high' | 'medium';
}

// === Migration Scout ===

export interface MigrationReport {
  modulePath: string;
  totalFiles: number;
  categories: {
    safeToMigrate: MigrationFileEntry[];
    requiresInvestigation: MigrationFileEntry[];
    doNotMigrate: MigrationFileEntry[];
  };
  executiveSummary: {
    totalAnalyzed: number;
    distribution: { safe: number; investigate: number; doNotMigrate: number };
    topRiskFiles: RiskFileEntry[];
  };
  historyConfidence: 'high' | 'limited';
}

export interface MigrationFileEntry {
  path: string;
  category: 'safe' | 'investigate' | 'do-not-migrate';
  reason: string;
  logicalDependencies?: string[];
  securityPatches?: string[];
  riskScore?: number;
}

export interface RiskFileEntry {
  path: string;
  riskScore: number;
  justification: string;
}

// === Logical Coupling ===

export interface LogicalCouplingResult {
  file: string;
  coupledFiles: CoupledFile[];
  analysisperiod: { start: string; end: string };
}

export interface CoupledFile {
  path: string;
  coOccurrencePercentage: number;
  sharedCommits: number;
  recentSharedCommits: { sha: string; date: string; message: string }[];
}

// === Configuration ===

export interface ArcheologyConfig {
  contributorThreshold: number;         // default: 20, min: 1
  docStalenessMonths: number;           // default: 6, min: 1
  analysisPeriodMonths: number;         // default: 12, min: 3
  coOccurrenceThreshold: number;        // default: 0.70, min: 0.50
  couplingAnalysisPeriodMonths: number; // default: 12, min: 3
  fileAgeThresholdYears: number;        // default: 2
  deletionLineThreshold: number;        // default: 10
  externalLlm?: {
    enabled: boolean;
    endpoint: string;
    apiKey: string;
  };
}

// === Graph Status ===

export interface GraphStatus {
  state: 'building' | 'ready' | 'error' | 'not-initialized';
  progress?: { processed: number; total: number };
  lastUpdated: string | null;
  totalNodes: { files: number; commits: number; authors: number; tickets: number };
  error?: string;
}

// === Internal Types ===

export interface BuildProgress {
  processed: number;
  total: number;
  state: 'building' | 'ready' | 'error';
  error?: string;
}

export interface UpdateResult {
  newCommits: number;
  newFiles: number;
  newAuthors: number;
  newTickets: number;
  duration: number;
}

// === Interfaces ===

export interface GitAdapter {
  // Core operations
  blame(file: string, startLine: number, endLine: number): Promise<BlameEntry[]>;
  log(options: GitLogOptions): Promise<CommitEntry[]>;
  logFollow(file: string): Promise<CommitEntry[]>;
  show(commitSha: string): Promise<CommitDetail>;

  // Repository info
  getRepoRoot(): Promise<string>;
  getGitDir(): Promise<string>;
  isValidRepo(): Promise<boolean>;

  // Diff and stats
  diffStat(commitSha: string): Promise<FileDiffStat[]>;
  numstat(commitSha: string): Promise<FileNumStat[]>;

  // Incremental
  getNewCommits(sinceCommit: string | null): Promise<CommitEntry[]>;
}

export interface GraphBuilder {
  // Initialization
  initialize(repoPath: string): Promise<void>;
  buildInitial(): Promise<BuildProgress>;

  // Incremental updates
  updateIncremental(): Promise<UpdateResult>;

  // Status
  getStatus(): Promise<GraphStatus>;
  isReady(): boolean;
}

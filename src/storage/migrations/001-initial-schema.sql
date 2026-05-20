-- Migration 001: Initial Knowledge Graph Schema
-- Creates the core tables for the Archeology Knowledge Graph

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_path TEXT NOT NULL,
    previous_paths TEXT NOT NULL DEFAULT '[]',
    first_commit_sha TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_files_current_path ON files(current_path);

CREATE TABLE IF NOT EXISTS commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sha TEXT NOT NULL UNIQUE,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    authored_date TEXT NOT NULL,
    message TEXT NOT NULL,
    lines_added INTEGER NOT NULL DEFAULT 0,
    lines_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_commits_sha ON commits(sha);
CREATE INDEX IF NOT EXISTS idx_commits_author_email ON commits(author_email);
CREATE INDEX IF NOT EXISTS idx_commits_authored_date ON commits(authored_date);

CREATE TABLE IF NOT EXISTS authors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    total_commits INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_authors_email ON authors(email);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    source_commit_sha TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_identifier ON tickets(identifier);

CREATE TABLE IF NOT EXISTS commit_files (
    commit_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    lines_added INTEGER NOT NULL DEFAULT 0,
    lines_deleted INTEGER NOT NULL DEFAULT 0,
    change_ratio REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (commit_id, file_id),
    FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commit_files_file_id ON commit_files(file_id);
CREATE INDEX IF NOT EXISTS idx_commit_files_commit_id ON commit_files(commit_id);

CREATE TABLE IF NOT EXISTS commit_tickets (
    commit_id INTEGER NOT NULL,
    ticket_id INTEGER NOT NULL,
    PRIMARY KEY (commit_id, ticket_id),
    FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commit_tickets_commit_id ON commit_tickets(commit_id);
CREATE INDEX IF NOT EXISTS idx_commit_tickets_ticket_id ON commit_tickets(ticket_id);

CREATE TABLE IF NOT EXISTS file_renames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    old_path TEXT NOT NULL,
    new_path TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    renamed_at TEXT NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_renames_file_id ON file_renames(file_id);

CREATE TABLE IF NOT EXISTS logical_couplings (
    file_a_id INTEGER NOT NULL,
    file_b_id INTEGER NOT NULL,
    shared_commits INTEGER NOT NULL DEFAULT 0,
    co_occurrence_ratio REAL NOT NULL DEFAULT 0.0,
    last_calculated TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (file_a_id, file_b_id),
    FOREIGN KEY (file_a_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (file_b_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_logical_couplings_file_a ON logical_couplings(file_a_id);
CREATE INDEX IF NOT EXISTS idx_logical_couplings_file_b ON logical_couplings(file_b_id);

-- Schema versioning table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

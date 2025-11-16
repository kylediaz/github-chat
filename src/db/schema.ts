import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const githubRepo = pgTable(
  'github_repo',
  {
    uuid: uuid('uuid').defaultRandom().primaryKey(),
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    fullName: text('full_name').notNull(),
    description: text('description'),
    defaultBranch: text('default_branch').notNull(),
    htmlUrl: text('html_url').notNull(),
    language: text('language'),
    stargazersCount: integer('stargazers_count').notNull().default(0),
    forksCount: integer('forks_count').notNull().default(0),
    watchersCount: integer('watchers_count').notNull().default(0),
    openIssuesCount: integer('open_issues_count').notNull().default(0),
    subscribersCount: integer('subscribers_count').notNull().default(0),
    fork: boolean('fork').notNull().default(false),
    private: boolean('private').notNull().default(false),
    licenseName: text('license_name'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  (table) => ({
    ownerRepoIdx: uniqueIndex('github_repo_owner_repo_idx').on(table.owner, table.repo),
  })
);

export const githubRepoCommit = pgTable(
  'github_repo_commit',
  {
    uuid: uuid('uuid').defaultRandom().primaryKey(),
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    sha: text('sha').notNull(),
    treeSha: text('tree_sha').notNull(),
    message: text('message').notNull(),
    authorName: text('author_name').notNull(),
    authorDate: timestamp('author_date').notNull(),
    htmlUrl: text('html_url').notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  (table) => ({
    ownerRepoShaIdx: uniqueIndex('github_repo_commit_owner_repo_sha_idx').on(
      table.owner,
      table.repo,
      table.sha
    ),
    ownerRepoIdx: index('github_repo_commit_owner_repo_idx').on(table.owner, table.repo),
    shaIdx: index('github_repo_commit_sha_idx').on(table.sha),
  })
);

export const githubRepoTrees = pgTable(
  'github_repo_trees',
  {
    uuid: uuid('uuid').defaultRandom().primaryKey(),
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    treeSha: text('tree_sha').notNull(),
    tree: jsonb('tree').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    ownerRepoTreeShaIdx: uniqueIndex('github_repo_trees_owner_repo_tree_sha_idx').on(
      table.owner,
      table.repo,
      table.treeSha
    ),
    ownerRepoIdx: index('github_repo_trees_owner_repo_idx').on(table.owner, table.repo),
  })
);

export const githubSyncSources = pgTable(
  'github_sync_sources',
  {
    uuid: uuid('uuid').defaultRandom().primaryKey(),
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    sourceId: uuid('source_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    ownerRepoIdx: uniqueIndex('github_sync_sources_owner_repo_idx').on(table.owner, table.repo),
  })
);

export const githubSyncInvocations = pgTable(
  'github_sync_invocations',
  {
    uuid: uuid('uuid').defaultRandom().primaryKey(),
    sourceUuid: uuid('source_uuid')
      .notNull()
      .references(() => githubSyncSources.uuid),
    invocationId: uuid('invocation_id').notNull(),
    refIdentifier: text('ref_identifier').notNull(),
    commitSha: text('commit_sha').notNull(),
    targetCollectionName: uuid('target_collection_name').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    sourceUuidIdx: index('github_sync_invocations_source_uuid_idx').on(table.sourceUuid),
    statusIdx: index('github_sync_invocations_status_idx').on(table.status),
    createdAtIdx: index('github_sync_invocations_created_at_idx').on(table.createdAt),
  })
);


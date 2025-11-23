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
  pgEnum,
} from "drizzle-orm/pg-core";

export const githubRepo = pgTable(
  "github_repo",
  {
    name: text("name").notNull().primaryKey(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),

    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),

    // null = not fetched yet
    // true = available
    // false = not available -- does not exist, inaccessible, etc.
    available: boolean("available"), 
  },
  (t) => ({
    ownerRepoIdx: uniqueIndex("github_repo_owner_repo_idx").on(t.owner, t.repo),
  })
);

// Exists only if the repo is available
export const githubRepoDetails = pgTable(
  "github_repo_details",
  {
    name: text("name")
      .notNull()
      .primaryKey()
      .references(() => githubRepo.name, { onDelete: "cascade" }),

    description: text("description").notNull(),
    defaultBranch: text("default_branch").notNull(),
    htmlUrl: text("html_url").notNull(),
    language: text("language").notNull(),
    stargazersCount: integer("stargazers_count").notNull(),
    forksCount: integer("forks_count").notNull(),
    watchersCount: integer("watchers_count").notNull(),
    openIssuesCount: integer("open_issues_count").notNull(),
    subscribersCount: integer("subscribers_count").notNull(),
    fork: boolean("fork").notNull(),
    private: boolean("private").notNull(),
    licenseName: text("license_name"),
    createdAt: timestamp("created_at").notNull(),
  }
);

export const githubRepoState = pgTable(
  "github_repo_state",
  {
    repoName: text("repo_name")
      .notNull()
      .primaryKey()
      .references(() => githubRepo.name),

    // Current commit SHA of HEAD from GET /repos/{owner}/{repo}/branches/{branch}
    latestCommitSha: text("latest_commit_sha").references(() => githubRepoCommit.sha),

    // Latest commit that has a completed invocation
    latestProcessedCommitSha: text("latest_processed_commit_sha").references(() => githubRepoCommit.sha),

    // Row-level lock for fetching GET /repos/{owner}/{repo}/branches/{branch}
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => ({
    repoNameIdx: uniqueIndex("github_repo_state_repo_name_idx").on(
      table.repoName,
    ),
  }),
);

export const githubRepoCommit = pgTable(
  "github_repo_commit",
  {

    sha: text("sha").notNull().primaryKey(),
    repoName: text("repo_name")
      .notNull()
      .references(() => githubRepo.name),
    
    // From the github API
    treeSha: text("tree_sha").notNull(),
    message: text("message").notNull(),
    authorName: text("author_name"),
    authorDate: timestamp("author_date"),
    htmlUrl: text("html_url").notNull(),

    // Row-level lock for fetching from the github API
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => ({
    repoNameShaIdx: uniqueIndex("github_repo_commit_repo_name_sha_idx").on(
      table.repoName,
      table.sha,
    ),
    repoNameIdx: index("github_repo_commit_repo_name_idx").on(table.repoName),
  }),
);

export const githubRepoTrees = pgTable(
  "github_repo_trees",
  {
    repoName: text("repo_name").notNull().references(() => githubRepo.name),
    treeSha: text("tree_sha").notNull(),
    tree: jsonb("tree"), // null = not fetched yet

    // Row-level lock for fetching from the github API
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => ({
    repoNameTreeShaIdx: uniqueIndex(
      "github_repo_trees_repo_name_tree_sha_idx",
    ).on(table.repoName, table.treeSha),
    repoNameIdx: index("github_repo_trees_repo_name_idx").on(table.repoName),
  }),
);

// Locks the creation of sync sources and invocations. Use chroma_sync_invocations.fetchedAt for locking status updates.
export const chromaSyncLock = pgTable(
  "chroma_sync_lock",
  {
    repoName: text("repo_name").notNull().references(() => githubRepo.name),
    lockAcquiredAt: timestamp("lock_acquired_at").defaultNow(), // null = not acquired
  },
  (table) => ({
    repoNameIdx: uniqueIndex("chroma_sync_lock_repo_name_idx").on(table.repoName),
  }),
);

export const chromaSyncSources = pgTable(
  "chroma_sync_sources",
  {
    uuid: uuid("source_uuid").notNull().primaryKey(),
    repoName: text("repo_name").notNull().references(() => githubRepo.name),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    repoNameIdx: uniqueIndex("chroma_sync_sources_repo_name_idx").on(
      table.repoName,
    ),
  }),
);

export const chromaSyncInvocationStatus = pgEnum("chroma_sync_invocation_status", ["pending", "processing", "cancelled", "completed", "failed"]);

export const chromaSyncInvocations = pgTable(
  "chroma_sync_invocations",
  {
    sourceUuid: uuid("source_uuid")
      .notNull()
      .references(() => chromaSyncSources.uuid),
    
    uuid: uuid("invocation_uuid").notNull().primaryKey(),
    refIdentifier: text("ref_identifier").notNull(), // SHA of the commit
    targetCollectionName: text("target_collection_name").notNull(),
    status: chromaSyncInvocationStatus("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),

    // Row-level lock for fetching status from the chroma sync API
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => ({
    sourceUuidIdx: index("chroma_sync_invocations_source_uuid_idx").on(
      table.sourceUuid,
    ),
    refIdentifierIdx: index("chroma_sync_invocations_ref_identifier_idx").on(table.refIdentifier),
    statusIdx: index("chroma_sync_invocations_status_idx").on(table.status),
    createdAtIdx: index("chroma_sync_invocations_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

# AGENTS.md

## Project Summary

This is a Next.js application that enables AI-powered chat with GitHub repositories using semantic code search. Users enter a repository URL, and the app:

1. Fetches repository metadata and commit information from the GitHub API
2. Syncs the repository code to Chroma using the Chroma Sync API (indexes code with Qwen/Qwen3-Embedding-0.6B)
3. Stores repository metadata, commits, and sync status in PostgreSQL
4. Provides a chat interface powered by OpenAI that queries the Chroma vector database for relevant code

The database tracks repositories, commits, Chroma sync sources, and invocation status. Repositories are automatically re-synced if the last invocation failed or if both the last commit fetch and last invocation are older than 24 hours.

## Chroma Sync API

Base URL: `https://sync.trychroma.com/api/v1`

### POST `/sources`

Create a source for a GitHub repository.

**Request:**

```json
{
  "github": {
    "include_globs": ["**/*"],
    "repository": "owner/repo"
  },
  "database_name": "string",
  "embedding": {
    "dense": {
      "model": "Qwen/Qwen3-Embedding-0.6B",
      "task": null
    },
    "sparse": null
  },
  "embedding_model": null
}
```

**Response:**

```json
{
  "source_id": "uuid"
}
```

### POST `/sources/{source_id}/invocations`

Create an invocation to index code for a specific commit SHA.

**Request:**

```json
{
  "ref_identifier": {
    "sha": "commit-sha"
    },
  "target_collection_name": "uuid"
}
```

**Response:**

```json
{
  "invocation_id": "uuid"
}
```

### GET `/invocations/{invocation_id}`

Get invocation status.

**Response:**

```json
{
  "id": "uuid",
  "status": "pending" | "processing" | "completed" | "failed" | { "complete": { "duration_ms": number, "finished_at": "string" } } | { "failed": { "error": "string" } },
  "created_at": "ISO8601",
  "metadata": {
    "collection_name": "string",
    "database_name": "string"
  }
}
```

## GitHub API

### GET `/repos/{owner}/{repo}`

**Fields used:**

- `full_name`, `description`, `default_branch`, `html_url`, `language`
- `stargazers_count`, `forks_count`, `watchers_count`, `open_issues_count`, `subscribers_count`
- `fork`, `private`, `license.name`

### GET `/repos/{owner}/{repo}/branches/{branch}`

**Fields used:**

- `commit.sha`
- `commit.commit.tree.sha`
- `commit.commit.message`
- `commit.commit.author.name`
- `commit.commit.author.date`
- `commit.html_url`

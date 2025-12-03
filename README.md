# GitHub Repository Chat

Chat with any GitHub repository using AI.

![preview](doc/1203.gif)

## Quick Start

Create a `.env.local` file with the following variables:

```bash
CHROMA_API_KEY=your_chroma_api_key
CHROMA_TENANT=your_chroma_tenant
CHROMA_DATABASE=your_chroma_database

GITHUB_APP_ID=your_github_app_id
GITHUB_TOKEN=your_github_personal_access_token

# Postgres Database
DATABASE_URL=postgresql://user:password@host:port/database

# OpenTelemetry Configuration (Optional)
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

OPENAI_API_KEY=your_openai_api_key
```

```bash
pnpm install

# Push schema to database
pnpm run db:generate
pnpm run db:push

pnpm dev
```

## How it works

When a user searches for a repo, it will automatically index the repo in Chroma using the Github Sync API.

Most of the complexity is regarding how distributed concensus is handled among requests. I abused Postgres row-level
locks and transactions over idempotency to make sure that this system doesn't have race conditions that will make
unnecessary API calls to github, or repo sync job invocations.

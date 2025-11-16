# GitHub Repository Chat

Chat with any GitHub repository using AI-powered semantic search. This application syncs GitHub repositories with Chroma for intelligent code exploration.

## Features

- 🔍 Semantic code search across any public GitHub repository
- 💬 AI-powered chat interface to explore codebases
- 🔄 Automatic repository syncing with Chroma
- 📊 Repository metadata and statistics display
- 🔐 Private repository detection and handling
- 📈 OpenTelemetry tracing for observability

## Prerequisites

- Node.js 18+ 
- A PostgreSQL database
- Chroma API access with GitHub sync enabled
- GitHub Personal Access Token
- OpenAI API key

## Environment Variables

Create a `.env.local` file with the following variables:

```bash
# Chroma API Configuration
CHROMA_API_KEY=your_chroma_api_key_here
CHROMA_TENANT=your_chroma_tenant
CHROMA_DATABASE=Chat%20With%20Github

# GitHub Configuration
GITHUB_APP_ID=your_github_app_id
GITHUB_TOKEN=your_github_personal_access_token

# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database

# OpenTelemetry Configuration (Optional)
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
```

## Installation

1. Install dependencies:

```bash
npm install
```

2. Set up the database schema:

```bash
# Generate migration files
npm run db:generate

# Push schema to database
npm run db:push
```

Or use Drizzle Studio to manage your database:

```bash
npm run db:studio
```

3. Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the application.

## Database Schema

The application uses four main tables:

- **github_repo**: Stores repository metadata from GitHub API
- **github_repo_commit**: Stores commit information for tracked repositories
- **github_sync_sources**: Tracks Chroma sync sources for each repository
- **github_sync_invocations**: Tracks individual sync invocations and their status

## How It Works

1. **Repository Input**: Enter a GitHub repository (e.g., `facebook/react`)
2. **GitHub API Fetch**: Fetches repository and commit metadata from GitHub
3. **Chroma Sync**: Creates a Chroma source and invocation to index the repository
4. **Status Polling**: Monitors sync progress until completion
5. **Chat Interface**: Once synced, you can chat with the AI about the codebase

### Resync Logic

Repositories are automatically re-synced if:
- The last invocation failed
- Both the last commit fetch AND last invocation are older than 24 hours

This prevents excessive API usage while keeping repositories reasonably up-to-date.

## API Routes

- `GET /api/repos/[owner]/[repo]/check` - Check repository sync status
- `POST /api/repos/[owner]/[repo]/sync` - Initiate repository sync
- `GET /api/repos/[owner]/[repo]/status` - Get current sync status
- `POST /api/chat/[owner]/[repo]` - Chat API with code search tools

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run Biome linter
- `npm run format` - Format code with Biome
- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Drizzle Studio

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **AI**: OpenAI GPT-4.1 with Vercel AI SDK
- **Database**: PostgreSQL with Drizzle ORM
- **Vector Search**: Chroma
- **Styling**: Tailwind CSS
- **Observability**: OpenTelemetry

## License

MIT

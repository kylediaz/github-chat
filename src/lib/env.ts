const requiredEnvVars = [
  'CHROMA_API_KEY',
  'CHROMA_TENANT',
  'CHROMA_DATABASE',
  'GITHUB_APP_ID',
  'GITHUB_TOKEN',
  'DATABASE_URL',
] as const;

export function validateEnv(): void {
  const missing: string[] = [];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join('\n')}\n\nPlease set these in your .env.local file.`
    );
  }
}

export const env = {
  CHROMA_API_KEY: process.env.CHROMA_API_KEY!,
  CHROMA_TENANT: process.env.CHROMA_TENANT!,
  CHROMA_DATABASE: process.env.CHROMA_DATABASE!,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID!,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
  DATABASE_URL: process.env.DATABASE_URL!,
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
};


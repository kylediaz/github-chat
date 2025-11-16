import { NextRequest, NextResponse } from 'next/server';
import { db, githubRepo, githubSyncSources, githubSyncInvocations } from '@/db';
import { eq, and, desc } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { validateEnv } from '@/lib/env';
import type { RepoCheckResponse, ErrorResponse } from '@/lib/api-models';

const tracer = trace.getTracer('api');

validateEnv();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const span = tracer.startSpan('api.repos.check');
  span.setAttributes({
    'github.owner': owner,
    'github.repo': repo,
  });

  try {
    const repoData = await db.query.githubRepo.findFirst({
      where: and(
        eq(githubRepo.owner, owner),
        eq(githubRepo.repo, repo)
      ),
    });

    if (!repoData) {
      span.setAttribute('repo.exists', false);
      const response: RepoCheckResponse = {
        exists: false,
        synced: false,
        sync_status: null,
        is_private: false,
        repo_info: null,
      };
      return NextResponse.json(response);
    }

    const source = await db.query.githubSyncSources.findFirst({
      where: and(
        eq(githubSyncSources.owner, owner),
        eq(githubSyncSources.repo, repo)
      ),
    });

    let syncStatus: string | null = null;
    let synced = false;

    if (source) {
      const latestInvocation = await db.query.githubSyncInvocations.findFirst({
        where: eq(githubSyncInvocations.sourceUuid, source.uuid),
        orderBy: [desc(githubSyncInvocations.createdAt)],
      });

      if (latestInvocation) {
        syncStatus = latestInvocation.status;
        synced = latestInvocation.status === 'completed';
      }
    }

    span.setAttributes({
      'repo.exists': true,
      'repo.synced': synced,
      'repo.sync_status': syncStatus || '',
    });

    const response: RepoCheckResponse = {
      exists: true,
      synced,
      sync_status: syncStatus,
      is_private: repoData.private,
      repo_info: {
        fullName: repoData.fullName,
        description: repoData.description,
        htmlUrl: repoData.htmlUrl,
        language: repoData.language,
        stargazersCount: repoData.stargazersCount,
        forksCount: repoData.forksCount,
        watchersCount: repoData.watchersCount,
        openIssuesCount: repoData.openIssuesCount,
      },
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error checking repo:', error);
    span.recordException(error as Error);
    const errorResponse: ErrorResponse = { error: 'Failed to check repository status' };
    return NextResponse.json(errorResponse, { status: 500 });
  } finally {
    span.end();
  }
}


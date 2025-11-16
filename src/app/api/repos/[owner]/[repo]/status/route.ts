import { NextRequest, NextResponse } from 'next/server';
import { db, githubRepo, githubRepoCommit, githubRepoTrees, githubSyncSources, githubSyncInvocations } from '@/db';
import { eq, and, desc } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { validateEnv } from '@/lib/env';
import { getInvocationStatus } from '@/lib/chroma';
import { transformTreeToHierarchy } from '@/lib/github';
import type { StatusResponse, ErrorResponse } from '@/lib/api-models';

const tracer = trace.getTracer('api');

validateEnv();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const span = tracer.startSpan('api.repos.status');
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
      const response: StatusResponse = {
        exists: false,
        synced: false,
        sync_status: null,
        is_private: false,
        repo_info: null,
        commit_sha: null,
        tree: null,
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
    let commitSha: string | null = null;
    let treeSha: string | null = null;

    if (source) {
      const latestInvocation = await db.query.githubSyncInvocations.findFirst({
        where: eq(githubSyncInvocations.sourceUuid, source.uuid),
        orderBy: [desc(githubSyncInvocations.createdAt)],
      });

      if (latestInvocation) {
        syncStatus = latestInvocation.status;
        synced = latestInvocation.status === 'completed';
        commitSha = latestInvocation.commitSha;

        const commitData = await db.query.githubRepoCommit.findFirst({
          where: and(
            eq(githubRepoCommit.owner, owner),
            eq(githubRepoCommit.repo, repo),
            eq(githubRepoCommit.sha, latestInvocation.commitSha)
          ),
        });

        if (commitData) {
          treeSha = commitData.treeSha;
        }

        const isTerminalState = latestInvocation.status === 'completed' || latestInvocation.status === 'failed' || latestInvocation.status === 'cancelled';
        
        if (!isTerminalState) {
          span.setAttribute('invocation.id', latestInvocation.invocationId);
          
          try {
            const statusData = await getInvocationStatus(latestInvocation.invocationId);
            const currentStatus = statusData.status;

            if (currentStatus !== latestInvocation.status) {
              await db.update(githubSyncInvocations)
                .set({ status: currentStatus })
                .where(eq(githubSyncInvocations.uuid, latestInvocation.uuid));

              span.addEvent('status_updated', {
                oldStatus: latestInvocation.status,
                newStatus: currentStatus,
              });

              syncStatus = currentStatus;
              synced = currentStatus === 'completed';
            }

            span.setAttribute('invocation.status', currentStatus);
          } catch (error) {
            console.error('Failed to fetch invocation status:', error);
            span.recordException(error as Error);
          }
        }
      }
    }

    let tree = null;
    if (treeSha) {
      const treeData = await db.query.githubRepoTrees.findFirst({
        where: and(
          eq(githubRepoTrees.owner, owner),
          eq(githubRepoTrees.repo, repo),
          eq(githubRepoTrees.treeSha, treeSha)
        ),
      });

      if (treeData && treeData.tree) {
        const treeArray = treeData.tree as any;
        if (Array.isArray(treeArray)) {
          tree = transformTreeToHierarchy(treeArray, repoData.fullName);
        }
      }
    }

    span.setAttributes({
      'repo.exists': true,
      'repo.synced': synced,
      'repo.sync_status': syncStatus || '',
    });

    const response: StatusResponse = {
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
      commit_sha: commitSha,
      tree,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error checking status:', error);
    span.recordException(error as Error);
    const errorResponse: ErrorResponse = { error: 'Failed to check repository status' };
    return NextResponse.json(errorResponse, { status: 500 });
  } finally {
    span.end();
  }
}


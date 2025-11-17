import { NextRequest, NextResponse } from 'next/server';
import { db, githubRepo, githubRepoCommit, githubRepoTrees, githubSyncSources, githubSyncInvocations } from '@/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { validateEnv } from '@/lib/env';
import { transformTreeToHierarchy } from '@/lib/github';
import { computeSyncStatus } from '@/lib/sync-status';
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
        sync_status: null,
        is_private: false,
        repo_info: null,
        commit_sha: null,
        tree: null,
      };
      return NextResponse.json(response);
    }

    // Compute sync status using shared utility
    const computedStatus = await computeSyncStatus(owner, repo);

    // Fetch all related data efficiently using joins
    // Query 1: Get source with latest invocation and latest commit in one query
    // Use a simpler approach - get source first, then join related data
    const source = await db.query.githubSyncSources.findFirst({
      where: and(
        eq(githubSyncSources.owner, owner),
        eq(githubSyncSources.repo, repo)
      ),
    });

    // Query 2: Get latest invocation and latest commit in parallel if source exists
    const [latestInvocation, latestCommit] = await Promise.all([
      source
        ? db.query.githubSyncInvocations.findFirst({
            where: eq(githubSyncInvocations.sourceUuid, source.uuid),
            orderBy: [desc(githubSyncInvocations.createdAt)],
          })
        : Promise.resolve(null),
      db.query.githubRepoCommit.findFirst({
        where: and(
          eq(githubRepoCommit.owner, owner),
          eq(githubRepoCommit.repo, repo)
        ),
        orderBy: [desc(githubRepoCommit.fetchedAt)],
      }),
    ]);

    // Query 3: Get completed invocation if source exists
    const completedInvocation = source
      ? await db.query.githubSyncInvocations.findFirst({
          where: and(
            eq(githubSyncInvocations.sourceUuid, source.uuid),
            eq(githubSyncInvocations.status, 'completed')
          ),
          orderBy: [desc(githubSyncInvocations.createdAt)],
        })
      : null;

    // Determine commit SHA
    let commitSha: string | null = null;
    if (completedInvocation) {
      commitSha = completedInvocation.commitSha;
    } else if (latestInvocation) {
      commitSha = latestInvocation.commitSha;
    } else if (latestCommit) {
      commitSha = latestCommit.sha;
    }

    // Query 4: Get commit data and tree in one query if we have a commit SHA
    let treeSha: string | null = null;
    let tree = null;

    if (commitSha) {
      const commitWithTree = await db
        .select({
          commit: githubRepoCommit,
          tree: githubRepoTrees,
        })
        .from(githubRepoCommit)
        .leftJoin(
          githubRepoTrees,
          and(
            eq(githubRepoTrees.owner, owner),
            eq(githubRepoTrees.repo, repo),
            eq(githubRepoTrees.treeSha, githubRepoCommit.treeSha)
          )
        )
        .where(
          and(
            eq(githubRepoCommit.owner, owner),
            eq(githubRepoCommit.repo, repo),
            eq(githubRepoCommit.sha, commitSha)
          )
        )
        .limit(1);

      if (commitWithTree.length > 0) {
        treeSha = commitWithTree[0].commit.treeSha;
        if (commitWithTree[0].tree && commitWithTree[0].tree.tree) {
          const treeArray = commitWithTree[0].tree.tree as any;
          if (Array.isArray(treeArray)) {
            tree = transformTreeToHierarchy(treeArray, repoData.fullName);
          }
        }
      }
    }

    span.setAttributes({
      'repo.exists': true,
      'repo.sync_status': computedStatus || '',
    });

    const response: StatusResponse = {
      exists: true,
      sync_status: computedStatus,
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


import { NextRequest, NextResponse } from "next/server";
import { trace } from "@opentelemetry/api";
import type { StatusResponse, ErrorResponse } from "@/types/api";

import {
  db,
  githubRepoCommit,
  githubRepoTrees,
  githubSyncSources,
  githubSyncInvocations,
  githubRepo,
} from "@/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getInvocationStatus } from "@/services/chroma/client";
import { validateEnv } from "@/lib/env";
import { getRepository } from "@/services/github/client";

const tracer = trace.getTracer("api");

validateEnv();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_UPDATE_THRESHOLD_MS = 2000;

function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

async function updateInvocationStatusIfNeeded(
  invocation: typeof githubSyncInvocations.$inferSelect,
): Promise<typeof githubSyncInvocations.$inferSelect> {
  const fetchedAt = invocation.fetchedAt;
  if (!fetchedAt) {
    return invocation;
  }

  const statusAge = Date.now() - fetchedAt.getTime();
  if (statusAge <= STATUS_UPDATE_THRESHOLD_MS || isTerminalStatus(invocation.status)) {
    return invocation;
  }

  let lockAcquired = false;

  await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
    SELECT invocation_uuid
    FROM github_sync_invocations
    WHERE invocation_uuid = ${invocation.uuid}
    FOR UPDATE SKIP LOCKED
  `);

    if (locked.length === 0) {
      return;
    }

    lockAcquired = true;

    try {
      const source = await tx.query.githubSyncSources.findFirst({
        where: eq(githubSyncSources.uuid, invocation.sourceUuid),
      });

      if (!source) {
        return;
      }

      const invocationId = (invocation as any).invocationId;
      if (!invocationId) {
        return;
      }

      const statusData = await getInvocationStatus(invocationId);
      await tx
        .update(githubSyncInvocations)
        .set({
          status: statusData.status,
          fetchedAt: new Date(),
        })
        .where(eq(githubSyncInvocations.uuid, invocation.uuid));
    } catch (error) {
      console.error("Failed to fetch invocation status:", error);
    }
  });

  if (!lockAcquired) {
    return invocation;
  }

  return await db.query.githubSyncInvocations.findFirst({
    where: eq(githubSyncInvocations.uuid, invocation.uuid),
  }) ?? invocation;
}

/**
* Get the status of a repository and its sync status.
* 
*/
export async function getFastCachedRepoStatus(owner: string, repo: string) {
  const repoName = `${owner}/${repo}`;

  const commitsWithDataPromise = db
    .select({
      commit: githubRepoCommit,
      tree: githubRepoTrees,
      invocation: githubSyncInvocations,
    })
    .from(githubRepoCommit)
    .leftJoin(
      githubRepoTrees,
      and(
        eq(githubRepoTrees.repoName, githubRepoCommit.repoName),
        eq(githubRepoTrees.treeSha, githubRepoCommit.treeSha),
      ),
    )
    .leftJoin(
      githubSyncInvocations,
      sql`${githubSyncInvocations.uuid} = (
              SELECT i2.invocation_uuid
              FROM github_sync_invocations i2
              INNER JOIN github_sync_sources s2 ON s2.uuid = i2.source_uuid
              WHERE i2.commit_sha = ${githubRepoCommit.sha}
                  AND s2.repo_name = ${githubRepoCommit.repoName}
              ORDER BY COALESCE(i2.fetched_at, i2.created_at) DESC
              LIMIT 1
          )`,
    )
    .where(eq(githubRepoCommit.repoName, repoName))
    .orderBy(desc(githubRepoCommit.fetchedAt))
    .limit(2);

  const [repoData, commitsWithData] = await Promise.all(
    [
      db.query.githubRepo.findFirst({
        where: eq(githubRepo.name, repoName),
      }),
      commitsWithDataPromise,
    ],
  );

  return {
    repo: repoData,
    latestCommits: commitsWithData,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
): Promise<NextResponse<StatusResponse | ErrorResponse>> {
  const { owner, repo: repoName } = await params;
  const span = tracer.startSpan("api.repos.status");

  try {
    // We assume the repo is already fully synced
    let { repo, latestCommits } = await getFastCachedRepoStatus(owner, repoName);
    let latestInvocation: typeof githubSyncInvocations.$inferSelect | null = latestCommits[0].invocation;
    const latestInvocationFetched = Date.now() - (latestInvocation?.fetchedAt?.getTime() ?? 0);

    if (!repo || repo.fetchedAt < new Date(Date.now() - ONE_DAY_MS * 30)) {
      // If the repo is new or stale, we try to get the repo info from the github API
      // We use fetchedAt as a row-level lock to avoid multiple fetches
      // Other concurrent requests will wait for the lock to be released
      // and all requests will return the same value
      const fetchedRepo = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT name
          FROM github_repo
          WHERE owner = ${owner} AND repo = ${repoName}
          FOR UPDATE SKIP LOCKED
        `);

        if (locked.length === 0) {
          return;
        }

        const ghRepo = await getRepository(owner, repoName);
        if ("notFound" in ghRepo && ghRepo.notFound) {
          await tx.update(githubRepo).set({
            exists: false,
            fetchedAt: new Date(),
          }).where(eq(githubRepo.name, repoName));
          return;
        }

        await tx.update(githubRepo).set({
          exists: true,
          fetchedAt: new Date(),
        }).where(eq(githubRepo.name, repoName));
        
        const repoData = await tx.query.githubRepo.findFirst({
          where: eq(githubRepo.name, repoName),
        });

        if (!repoData) {
          return;
        }

        return repoData;
      });
      if (fetchedRepo) {
        repo = fetchedRepo;
      }
    }
    if (!repo?.exists) {
      return NextResponse.json({ error: `Repository ${repoName} not found (last checked ${repo?.fetchedAt?.toISOString() ?? "never"})` }, { status: 404 });
    }
    
    if (latestInvocation && !isTerminalStatus(latestInvocation.status) && latestInvocationFetched > STATUS_UPDATE_THRESHOLD_MS) {
      // The invocation is still running. We should refetch the status from the chroma sync API
      // we use fetchedAt as a row-level lock to avoid multiple fetches
      // Other concurrent requests will not wait for the lock to be released, instead they
      // will return the out of date value currently stored in the DB.
      const updatedInvocation = await updateInvocationStatusIfNeeded(latestInvocation);
      if (!updatedInvocation) {
        return NextResponse.json({ error: "Failed to update invocation status" }, { status: 500 });
      }
      latestInvocation = updatedInvocation;
    }

  } catch (error) {
    span.recordException(error as Error);
    const errorResponse: ErrorResponse = {
      error: "Failed to check repository status",
    };
    return NextResponse.json(errorResponse, { status: 500 });
  } finally {
    span.end();
  }
}

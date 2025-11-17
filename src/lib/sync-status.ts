import { db } from '@/db';
import { githubSyncSources, githubSyncInvocations, githubRepoCommit } from '@/db';
import { eq, and, desc } from 'drizzle-orm';
import { getInvocationStatus } from '@/lib/chroma';
import type { RepoSyncStatus } from './api-models';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Computes the sync status for a repository based on invocations and commits.
 * Returns null if the repository doesn't exist.
 */
export async function computeSyncStatus(
  owner: string,
  repo: string
): Promise<RepoSyncStatus | null> {
  // Check if source exists
  const source = await db.query.githubSyncSources.findFirst({
    where: and(
      eq(githubSyncSources.owner, owner),
      eq(githubSyncSources.repo, repo)
    ),
  });

  // If no source exists, status is 'processing'
  if (!source) {
    return 'processing';
  }

  // Find latest invocation
  const latestInvocation = await db.query.githubSyncInvocations.findFirst({
    where: eq(githubSyncInvocations.sourceUuid, source.uuid),
    orderBy: [desc(githubSyncInvocations.createdAt)],
  });

  // If no invocations exist, status is 'processing'
  if (!latestInvocation) {
    return 'processing';
  }

  // Check if there are any completed invocations
  const completedInvocation = await db.query.githubSyncInvocations.findFirst({
    where: and(
      eq(githubSyncInvocations.sourceUuid, source.uuid),
      eq(githubSyncInvocations.status, 'completed')
    ),
    orderBy: [desc(githubSyncInvocations.createdAt)],
  });

  // If no completed invocations exist, check latest invocation status
  if (!completedInvocation) {
    // Handle cancelled as 'failed'
    if (latestInvocation.status === 'cancelled') {
      return 'failed';
    }

    // Handle failed status
    if (latestInvocation.status === 'failed') {
      return 'failed';
    }

    // Update invocation status if it's not in a terminal state
    let currentInvocationStatus = latestInvocation.status;
    const isTerminalState = 
      latestInvocation.status === 'completed' || 
      latestInvocation.status === 'failed' || 
      latestInvocation.status === 'cancelled';

    if (!isTerminalState) {
      try {
        const statusData = await getInvocationStatus(latestInvocation.invocationId);
        currentInvocationStatus = statusData.status;

        // Update database if status changed
        if (currentInvocationStatus !== latestInvocation.status) {
          await db.update(githubSyncInvocations)
            .set({ status: currentInvocationStatus })
            .where(eq(githubSyncInvocations.uuid, latestInvocation.uuid));
        }

        // Handle cancelled as 'failed'
        if (currentInvocationStatus === 'cancelled') {
          return 'failed';
        }

        // Handle failed status
        if (currentInvocationStatus === 'failed') {
          return 'failed';
        }
      } catch (error) {
        console.error('Failed to fetch invocation status:', error);
        // Continue with stored status if fetch fails
      }
    }

    // If invocation is still processing/pending, check if it's recent
    if (currentInvocationStatus === 'pending' || currentInvocationStatus === 'processing') {
      const invocationAge = Date.now() - latestInvocation.createdAt.getTime();
      if (invocationAge < ONE_DAY_MS) {
        // Recent processing invocation - status is 'processing'
        return 'processing';
      }
      // Old processing invocation - treat as failed
      return 'failed';
    }
  }

  // Get latest commit from database
  const latestCommit = await db.query.githubRepoCommit.findFirst({
    where: and(
      eq(githubRepoCommit.owner, owner),
      eq(githubRepoCommit.repo, repo)
    ),
    orderBy: [desc(githubRepoCommit.fetchedAt)],
  });

  // If no commit data, can't determine status - return 'processing'
  if (!latestCommit) {
    return 'processing';
  }

  // If we have a completed invocation, check if it's up to date
  if (completedInvocation) {
    const invocationCommit = await db.query.githubRepoCommit.findFirst({
      where: and(
        eq(githubRepoCommit.owner, owner),
        eq(githubRepoCommit.repo, repo),
        eq(githubRepoCommit.sha, completedInvocation.commitSha)
      ),
    });

    if (!invocationCommit) {
      // Can't find commit for invocation - treat as processing
      return 'processing';
    }

    // Check if invocation commit is the latest commit
    const isLatestCommit = invocationCommit.sha === latestCommit.sha;
    
    if (isLatestCommit) {
      // Same commit - up to date (regardless of age)
      return 'up_to_date';
    } else {
      // Different commit - check if invocation is old
      const invocationAge = Date.now() - completedInvocation.createdAt.getTime();
      if (invocationAge >= ONE_DAY_MS) {
        // Old invocation with different commit - out of date
        return 'out_of_date';
      } else {
        // Recent completed invocation but different commit - still processing (newer commit exists)
        return 'processing';
      }
    }
  }

  // Fallback to processing (should not reach here if logic is correct)
  return 'processing';
}


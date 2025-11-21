import { NextRequest, NextResponse } from 'next/server';
import { db, githubRepo, githubRepoCommit, githubRepoTrees, githubSyncSources, githubSyncInvocations } from '@/db';
import { eq, and, desc } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { validateEnv } from '@/lib/env';
import { getRepository, getBranchCommit, getRepositoryTree } from '@/lib/github';
import { createSource, createInvocation, getInvocationStatus } from '@/lib/chroma';
import { randomUUID } from 'crypto';
import type { SyncResponse, ErrorResponse, RepoSyncStatus } from '@/lib/api-models';

const tracer = trace.getTracer('api');

validateEnv();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function computeStatusFromData(
  owner: string,
  repo: string,
  source: typeof githubSyncSources.$inferSelect | null,
  latestInvocation: typeof githubSyncInvocations.$inferSelect | null,
  completedInvocation: typeof githubSyncInvocations.$inferSelect | null,
  latestCommit: typeof githubRepoCommit.$inferSelect | null
): Promise<RepoSyncStatus> {
  // If no source exists, status is 'processing'
  if (!source) {
    return 'processing';
  }

  // If no invocations exist, status is 'processing'
  if (!latestInvocation) {
    return 'processing';
  }

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
        return 'processing';
      }
      return 'failed';
    }
  }

  // Get latest commit from database if not provided
  let commit = latestCommit;
  if (!commit) {
    commit = (await db.query.githubRepoCommit.findFirst({
      where: and(
        eq(githubRepoCommit.owner, owner),
        eq(githubRepoCommit.repo, repo)
      ),
      orderBy: [desc(githubRepoCommit.fetchedAt)],
    })) ?? null;
  }

  // If no commit data, can't determine status - return 'processing'
  if (!commit) {
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
      return 'processing';
    }

    // Check if invocation commit is the latest commit
    const isLatestCommit = invocationCommit.sha === commit.sha;
    
    if (isLatestCommit) {
      return 'up_to_date';
    } else {
      // Different commit - check if invocation is old
      const invocationAge = Date.now() - completedInvocation.createdAt.getTime();
      if (invocationAge >= ONE_DAY_MS) {
        return 'out_of_date';
      } else {
        return 'processing';
      }
    }
  }

  return 'processing';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;
  const span = tracer.startSpan('api.repos.sync');
  span.setAttributes({
    'github.owner': owner,
    'github.repo': repo,
  });

  try {
    // Step 1: Check if repo already in github_repo table
      let repoData = await db.query.githubRepo.findFirst({
        where: and(
          eq(githubRepo.owner, owner),
          eq(githubRepo.repo, repo)
        ),
      });

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      let shouldFetchRepo = !repoData || (repoData.fetchedAt && repoData.fetchedAt < oneDayAgo);

      if (shouldFetchRepo) {
        span.addEvent('fetching_repo_from_github');
        
        const ghRepo = await getRepository(owner, repo);
        
        if (!ghRepo) {
          const errorResponse: ErrorResponse = { error: 'Repository not found' };
          return NextResponse.json(errorResponse, { status: 404 });
        }

        if ('notFound' in ghRepo) {
          const errorResponse: ErrorResponse = { error: 'Repository not found' };
          return NextResponse.json(errorResponse, { status: 404 });
        }

        if ('accessible' in ghRepo && ghRepo.accessible === false && ghRepo.private === true) {
          await db.insert(githubRepo)
            .values({
              owner,
              repo,
              fullName: `${owner}/${repo}`,
              description: null,
              defaultBranch: 'main',
              htmlUrl: `https://github.com/${owner}/${repo}`,
              language: null,
              stargazersCount: 0,
              forksCount: 0,
              watchersCount: 0,
              openIssuesCount: 0,
              subscribersCount: 0,
              fork: false,
              private: true,
              licenseName: null,
            })
            .onConflictDoUpdate({
              target: [githubRepo.owner, githubRepo.repo],
              set: { private: true, fetchedAt: new Date() },
            });

          const errorResponse: ErrorResponse = { error: 'Repository is private and cannot be accessed' };
          return NextResponse.json(errorResponse, { status: 403 });
        }

        if ('fullName' in ghRepo) {
          const [insertedRepo] = await db.insert(githubRepo)
            .values({
              owner: ghRepo.owner,
              repo: ghRepo.repo,
              fullName: ghRepo.fullName,
              description: ghRepo.description,
              defaultBranch: ghRepo.defaultBranch,
              htmlUrl: ghRepo.htmlUrl,
              language: ghRepo.language,
              stargazersCount: ghRepo.stargazersCount,
              forksCount: ghRepo.forksCount,
              watchersCount: ghRepo.watchersCount,
              openIssuesCount: ghRepo.openIssuesCount,
              subscribersCount: ghRepo.subscribersCount,
              fork: ghRepo.fork,
              private: ghRepo.private,
              licenseName: ghRepo.licenseName,
            })
            .onConflictDoUpdate({
              target: [githubRepo.owner, githubRepo.repo],
              set: {
                description: ghRepo.description,
                defaultBranch: ghRepo.defaultBranch,
                htmlUrl: ghRepo.htmlUrl,
                language: ghRepo.language,
                stargazersCount: ghRepo.stargazersCount,
                forksCount: ghRepo.forksCount,
                watchersCount: ghRepo.watchersCount,
                openIssuesCount: ghRepo.openIssuesCount,
                subscribersCount: ghRepo.subscribersCount,
                fork: ghRepo.fork,
                private: ghRepo.private,
                licenseName: ghRepo.licenseName,
                fetchedAt: new Date(),
              },
            })
            .returning();

          repoData = insertedRepo;
          span.addEvent('repo_cached');
        }
      }

      if (!repoData) {
        const errorResponse: ErrorResponse = { error: 'Failed to fetch repository' };
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // Step 2: Fetch latest commit on default branch
      const latestCommitInDb = await db.query.githubRepoCommit.findFirst({
        where: and(
          eq(githubRepoCommit.owner, owner),
          eq(githubRepoCommit.repo, repo)
        ),
        orderBy: [desc(githubRepoCommit.fetchedAt)],
      });

      let shouldFetchCommit = !latestCommitInDb || (latestCommitInDb.fetchedAt && latestCommitInDb.fetchedAt < oneDayAgo);
      let commitData = latestCommitInDb;

      if (shouldFetchCommit) {
        span.addEvent('fetching_commit_from_github', {
          branch: repoData.defaultBranch,
        });
        
        const ghCommit = await getBranchCommit(owner, repo, repoData.defaultBranch);
        
        if (!ghCommit) {
          const errorResponse: ErrorResponse = { error: 'Failed to fetch branch commit' };
          return NextResponse.json(errorResponse, { status: 500 });
        }

        const [insertedCommit] = await db.insert(githubRepoCommit)
          .values({
            owner,
            repo,
            sha: ghCommit.sha,
            treeSha: ghCommit.treeSha,
            message: ghCommit.message,
            authorName: ghCommit.authorName,
            authorDate: ghCommit.authorDate,
            htmlUrl: ghCommit.htmlUrl,
          })
          .onConflictDoUpdate({
            target: [githubRepoCommit.owner, githubRepoCommit.repo, githubRepoCommit.sha],
            set: {
              fetchedAt: new Date(),
            },
          })
          .returning();

        commitData = insertedCommit;
        span.addEvent('commit_cached', {
          sha: ghCommit.sha.substring(0, 7),
        });

        const existingTree = await db.query.githubRepoTrees.findFirst({
          where: and(
            eq(githubRepoTrees.owner, owner),
            eq(githubRepoTrees.repo, repo),
            eq(githubRepoTrees.treeSha, ghCommit.treeSha)
          ),
        });

        if (!existingTree) {
          span.addEvent('fetching_tree_from_github', {
            treeSha: ghCommit.treeSha.substring(0, 7),
          });

          const ghTree = await getRepositoryTree(owner, repo, ghCommit.treeSha);

          if (ghTree) {
            await db.insert(githubRepoTrees)
              .values({
                owner,
                repo,
                treeSha: ghTree.sha,
                tree: ghTree.tree,
              })
              .onConflictDoUpdate({
                target: [githubRepoTrees.owner, githubRepoTrees.repo, githubRepoTrees.treeSha],
                set: {
                  tree: ghTree.tree,
                },
              });

            span.addEvent('tree_cached', {
              treeSha: ghTree.sha.substring(0, 7),
              entriesCount: ghTree.tree.length,
            });
          }
        }
      } else if (commitData) {
        const existingTree = await db.query.githubRepoTrees.findFirst({
          where: and(
            eq(githubRepoTrees.owner, owner),
            eq(githubRepoTrees.repo, repo),
            eq(githubRepoTrees.treeSha, commitData.treeSha)
          ),
        });

        if (!existingTree) {
          span.addEvent('fetching_tree_from_github', {
            treeSha: commitData.treeSha.substring(0, 7),
          });

          const ghTree = await getRepositoryTree(owner, repo, commitData.treeSha);

          if (ghTree) {
            await db.insert(githubRepoTrees)
              .values({
                owner,
                repo,
                treeSha: ghTree.sha,
                tree: ghTree.tree,
              })
              .onConflictDoUpdate({
                target: [githubRepoTrees.owner, githubRepoTrees.repo, githubRepoTrees.treeSha],
                set: {
                  tree: ghTree.tree,
                },
              });

            span.addEvent('tree_cached', {
              treeSha: ghTree.sha.substring(0, 7),
              entriesCount: ghTree.tree.length,
            });
          }
        }
      }

      if (!commitData) {
        const errorResponse: ErrorResponse = { error: 'Failed to fetch commit' };
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // Step 3: Compute current status and check if sync is needed
      // Fetch data needed for status computation
      const sourceResult = await db.query.githubSyncSources.findFirst({
        where: and(
          eq(githubSyncSources.owner, owner),
          eq(githubSyncSources.repo, repo)
        ),
      });
      let source: typeof githubSyncSources.$inferSelect | null = sourceResult ?? null;

      const [latestInvocation, completedInvocation, latestCommit] = await Promise.all([
        source
          ? db.query.githubSyncInvocations.findFirst({
              where: eq(githubSyncInvocations.sourceUuid, source.uuid),
              orderBy: [desc(githubSyncInvocations.createdAt)],
            })
          : Promise.resolve(null),
        source
          ? db.query.githubSyncInvocations.findFirst({
              where: and(
                eq(githubSyncInvocations.sourceUuid, source.uuid),
                eq(githubSyncInvocations.status, 'completed')
              ),
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

      const currentStatus = await computeStatusFromData(
        owner,
        repo,
        source,
        latestInvocation ?? null,
        completedInvocation ?? null,
        latestCommit ?? null
      );

      // If already up to date, return early (idempotent)
      if (currentStatus === 'up_to_date') {
        span.addEvent('sync_up_to_date');
        const response: SyncResponse = { status: 'up_to_date' };
        return NextResponse.json(response);
      }

      // If processing with recent invocation, don't create duplicate
      if (currentStatus === 'processing' && latestInvocation) {
        const invocationAge = Date.now() - latestInvocation.createdAt.getTime();
        // If there's a recent invocation (<1 day old), don't create duplicate
        if (invocationAge < ONE_DAY_MS) {
          span.addEvent('sync_already_processing');
          const response: SyncResponse = { status: 'processing' };
          return NextResponse.json(response);
        }
      }

      // Step 4: Create or get Chroma source
      if (!source) {
        span.addEvent('creating_chroma_source');
        
        try {
          const sourceData = await createSource(owner, repo);
          
          const [insertedSource] = await db.insert(githubSyncSources)
            .values({
              owner,
              repo,
              sourceId: sourceData.source_id,
            })
            .onConflictDoUpdate({
              target: [githubSyncSources.owner, githubSyncSources.repo],
              set: {
                sourceId: sourceData.source_id,
              },
            })
            .returning();

          source = insertedSource;
          span.setAttribute('source.id', sourceData.source_id);
        } catch (error) {
          console.error('Chroma source creation failed:', error);
          
          // If it's a duplicate key error, try to fetch the existing source
          const errorCode = (error as any)?.code || (error as any)?.cause?.code;
          if (errorCode === '23505') {
            const existingSource = await db.query.githubSyncSources.findFirst({
              where: and(
                eq(githubSyncSources.owner, owner),
                eq(githubSyncSources.repo, repo)
              ),
            });
            
            if (existingSource) {
              source = existingSource;
              span.setAttribute('source.id', existingSource.sourceId);
              span.addEvent('source_already_exists');
            } else {
              const errorResponse: ErrorResponse = { error: 'Failed to create Chroma source' };
              return NextResponse.json(errorResponse, { status: 500 });
            }
          } else {
            const errorResponse: ErrorResponse = { error: 'Failed to create Chroma source' };
            return NextResponse.json(errorResponse, { status: 500 });
          }
        }
      }

      // Step 5: Create invocation
      const collectionName = randomUUID();
      
      span.addEvent('creating_invocation', {
        commitSha: commitData.sha.substring(0, 7),
      });
      
      try {
        const invocationData = await createInvocation(
          source.sourceId,
          commitData.sha,
          collectionName
        );

        await db.insert(githubSyncInvocations)
          .values({
            sourceUuid: source.uuid,
            invocationId: invocationData.invocation_id,
            refIdentifier: commitData.sha,
            commitSha: commitData.sha,
            targetCollectionName: collectionName,
            status: 'pending',
          });

        span.setAttribute('invocation.id', invocationData.invocation_id);
      } catch (error) {
        console.error('Chroma invocation creation failed:', error);
        const errorResponse: ErrorResponse = { error: 'Failed to create Chroma invocation' };
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // Return computed status after creating invocation
      // Fetch updated data after creating invocation
      const updatedLatestInvocation = await db.query.githubSyncInvocations.findFirst({
        where: eq(githubSyncInvocations.sourceUuid, source.uuid),
        orderBy: [desc(githubSyncInvocations.createdAt)],
      });

      const updatedCompletedInvocation = await db.query.githubSyncInvocations.findFirst({
        where: and(
          eq(githubSyncInvocations.sourceUuid, source.uuid),
          eq(githubSyncInvocations.status, 'completed')
        ),
        orderBy: [desc(githubSyncInvocations.createdAt)],
      });

      const newStatus = await computeStatusFromData(
        owner,
        repo,
        source,
        updatedLatestInvocation ?? null,
        updatedCompletedInvocation ?? null,
        commitData
      );
      const response: SyncResponse = { status: newStatus };
      return NextResponse.json(response);
    } catch (error) {
      console.error('Error syncing repo:', error);
      span.recordException(error as Error);
      const errorResponse: ErrorResponse = { error: 'Failed to sync repository' };
      return NextResponse.json(errorResponse, { status: 500 });
    } finally {
      span.end();
    }
}


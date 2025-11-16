import { NextRequest, NextResponse } from 'next/server';
import { db, githubRepo, githubRepoCommit, githubRepoTrees, githubSyncSources, githubSyncInvocations } from '@/db';
import { eq, and, desc } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { validateEnv } from '@/lib/env';
import { getRepository, getBranchCommit, getRepositoryTree } from '@/lib/github';
import { createSource, createInvocation } from '@/lib/chroma';
import { randomUUID } from 'crypto';
import type { SyncResponse, ErrorResponse } from '@/lib/api-models';

const tracer = trace.getTracer('api');

validateEnv();

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

      // Step 3: Check resync eligibility
      let source = await db.query.githubSyncSources.findFirst({
        where: and(
          eq(githubSyncSources.owner, owner),
          eq(githubSyncSources.repo, repo)
        ),
      });

      if (source) {
        const latestInvocation = await db.query.githubSyncInvocations.findFirst({
          where: eq(githubSyncInvocations.sourceUuid, source.uuid),
          orderBy: [desc(githubSyncInvocations.createdAt)],
        });

        if (latestInvocation) {
          const canResync =
            latestInvocation.status === 'failed' ||
            (commitData.fetchedAt > oneDayAgo && latestInvocation.createdAt < oneDayAgo);

          if (!canResync && latestInvocation.status === 'completed') {
            span.addEvent('sync_up_to_date');
            const response: SyncResponse = { status: 'up_to_date' };
            return NextResponse.json(response);
          }

          if (!canResync) {
            span.addEvent('sync_rate_limited');
            const response: SyncResponse = { status: latestInvocation.status };
            return NextResponse.json(response);
          }
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

      const response: SyncResponse = { status: 'pending' };
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


import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, tool as createTool, stepCountIs } from 'ai';
import type { UIMessage } from 'ai';
import { db, githubRepoCommit, githubSyncInvocations } from '@/db';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateEnv } from '@/lib/env';
import { queryCollection } from '@/lib/chroma';
import type { ErrorResponse } from '@/lib/api-models';

validateEnv();

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params;

  try {
      const { messages }: { messages: UIMessage[] } = await req.json();

      // Get commit with completed invocation, ordered by commit fetchedAt
      const commitWithInvocation = await db
        .select({
          commit: githubRepoCommit,
          invocation: githubSyncInvocations,
        })
        .from(githubRepoCommit)
        .innerJoin(
          githubSyncInvocations,
          and(
            eq(githubSyncInvocations.commitSha, githubRepoCommit.sha),
            eq(githubSyncInvocations.status, 'completed')
          )
        )
        .where(
          and(
            eq(githubRepoCommit.owner, owner),
            eq(githubRepoCommit.repo, repo)
          )
        )
        .orderBy(desc(githubRepoCommit.fetchedAt))
        .limit(1);

      if (commitWithInvocation.length === 0) {
        const errorResponse: ErrorResponse = { error: 'No completed sync found' };
        return new Response(
          JSON.stringify(errorResponse),
          { status: 400 }
        );
      }

      const latestInvocation = commitWithInvocation[0].invocation;

      const collectionName = latestInvocation.targetCollectionName;
      const commitSha = latestInvocation.commitSha;

      const tools = {
        searchFiles: createTool({
          description: 'Search for specific files or file patterns in the repository. Use this to find files by name or path.',
          inputSchema: z.object({
            query: z.string().describe('The file name or path pattern to search for'),
          }),
          execute: async ({ query }: { query: string }) => {
            const results = await queryCollection(
              collectionName,
              query,
              10
            );

            const groupedByPath = new Map<string, typeof results>();
            
            for (const r of results) {
              const key = r.metadata?.document_key || 'unknown';
              if (!groupedByPath.has(key)) {
                groupedByPath.set(key, []);
              }
              groupedByPath.get(key)!.push(r);
            }

            const combinedResults = Array.from(groupedByPath.entries()).map(([path, groupResults]) => {
              const sorted = groupResults.sort((a, b) => {
                const aStart = a.metadata?.start_line ?? Infinity;
                const bStart = b.metadata?.start_line ?? Infinity;
                return aStart - bStart;
              });

              const contents = sorted
                .map((r) => r.document)
                .filter((doc): doc is string => doc !== undefined);
              
              return {
                path,
                content: contents.join('...'),
              };
            });

            return {
              results: combinedResults,
            };
          },
        }),
      };

      const result = streamText({
        model: openai('gpt-4.1'),
        system: `You are a helpful AI assistant that helps users understand the ${owner}/${repo} GitHub repository.

The code is indexed at commit ${commitSha}.

You have access to tools to search through the repository code and files. Use these tools to provide accurate, context-aware answers about the codebase.

When referencing code, always cite the file path and provide relevant context. Keep your answers concise and focused on the user's question.

You can make at most 2 tool calls every time the user asks a question. Try to answer the question before hand. If you can't find the answer, succintly describe what you've found.`,
        messages: convertToModelMessages(messages),
        tools,
        stopWhen: stepCountIs(5),
      });

      return result.toUIMessageStreamResponse({
        sendReasoning: true,
        onError: (error: unknown) => {
          console.error('Chat error:', error);
          const message = error instanceof Error ? error.message : 'Unknown error';
          return `An error occurred: ${message}`;
        },
      });
    } catch (error) {
      console.error('Chat API Error:', error);
      const errorResponse: ErrorResponse = { error: 'Internal Server Error' };
      return new Response(
        JSON.stringify(errorResponse),
        { status: 500 }
      );
    }
}


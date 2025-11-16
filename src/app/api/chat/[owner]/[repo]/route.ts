import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, tool as createTool, stepCountIs } from 'ai';
import type { UIMessage } from 'ai';
import { db, githubSyncSources, githubSyncInvocations } from '@/db';
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

      const source = await db.query.githubSyncSources.findFirst({
        where: and(
          eq(githubSyncSources.owner, owner),
          eq(githubSyncSources.repo, repo)
        ),
      });

      if (!source) {
        const errorResponse: ErrorResponse = { error: 'Repository not synced' };
        return new Response(
          JSON.stringify(errorResponse),
          { status: 404 }
        );
      }

      const latestInvocation = await db.query.githubSyncInvocations.findFirst({
        where: eq(githubSyncInvocations.sourceUuid, source.uuid),
        orderBy: [desc(githubSyncInvocations.createdAt)],
      });

      if (!latestInvocation || latestInvocation.status !== 'completed') {
        const errorResponse: ErrorResponse = { error: 'Repository sync not completed' };
        return new Response(
          JSON.stringify(errorResponse),
          { status: 400 }
        );
      }

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
              `file path: ${query}`,
              10
            );

            return {
              results: results.map((r) => ({
                path: r.metadata?.document_key || 'unknown',
                content: r.document,
                relevanceScore: 1 - r.distance,
              })),
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


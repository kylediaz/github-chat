import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  streamText,
  tool as createTool,
  stepCountIs,
} from "ai";
import type { UIMessage } from "ai";
import {
  db,
  githubRepoState,
  githubRepoDetails,
  githubRepoCommit,
  githubRepoTrees,
  chromaSyncInvocations,
} from "@/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { validateEnv } from "@/lib/env";
import { queryCollection } from "@/services/chroma/client";
import type { ErrorResponse } from "@/types/api";
import type { GitHubTree } from "@/types/github";

validateEnv();

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;

  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const repoData = await db
      .select({
        state: githubRepoState,
        details: githubRepoDetails,
        commit: githubRepoCommit,
        tree: githubRepoTrees,
        invocation: chromaSyncInvocations,
      })
      .from(githubRepoState)
      .innerJoin(
        githubRepoDetails,
        eq(githubRepoDetails.name, githubRepoState.repoName),
      )
      .innerJoin(
        chromaSyncInvocations,
        eq(
          chromaSyncInvocations.refIdentifier,
          githubRepoState.latestProcessedCommitSha,
        ),
      )
      .innerJoin(
        githubRepoCommit,
        eq(githubRepoCommit.sha, githubRepoState.latestProcessedCommitSha),
      )
      .leftJoin(
        githubRepoTrees,
        and(
          eq(githubRepoTrees.repoName, githubRepoState.repoName),
          eq(githubRepoTrees.treeSha, githubRepoCommit.treeSha),
        ),
      )
      .where(eq(githubRepoState.repoName, `${owner}/${repo}`))
      .limit(1);

    if (repoData.length === 0) {
      const errorResponse: ErrorResponse = { error: "Not synced" };
      return new Response(JSON.stringify(errorResponse), { status: 400 });
    }

    const { state, details, tree: treeRow, invocation } = repoData[0];

    if (state.latestCommitSha && !state.latestProcessedCommitSha) {
      const errorResponse: ErrorResponse = {
        error: "Repository has not completed its first sync",
      };
      return new Response(JSON.stringify(errorResponse), { status: 400 });
    }

    if (invocation.status !== "completed") {
      const errorResponse: ErrorResponse = {
        error: "latestProcessedCommitSha is not complete",
      };
      return new Response(JSON.stringify(errorResponse), { status: 500 });
    }

    const collectionName = invocation.targetCollectionName;
    const commitSha = invocation.refIdentifier;

    const rawTree = (treeRow?.tree as GitHubTree["tree"]) ?? [];
    const directories = rawTree
      .filter((entry) => entry.type === "tree")
      .map((entry) => entry.path)
      .sort();

    const tools = {
      searchFiles: createTool({
        description:
          "Search for specific files or file patterns in the repository. Use this to find files by name or path.",
        inputSchema: z.object({
          query: z
            .string()
            .describe("The file name or path pattern to search for"),
        }),
        execute: async ({ query }: { query: string }) => {
          const results = await queryCollection(collectionName, query, 10);

          const groupedByPath = new Map<string, typeof results>();

          for (const r of results) {
            const key = r.metadata?.document_key || "unknown";
            if (!groupedByPath.has(key)) {
              groupedByPath.set(key, []);
            }
            groupedByPath.get(key)!.push(r);
          }

          const combinedResults = Array.from(groupedByPath.entries()).map(
            ([path, groupResults]) => {
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
                content: contents.join("..."),
              };
            },
          );

          return {
            results: combinedResults,
          };
        },
      }),
    };

    const result = streamText({
      model: openai("gpt-5-mini"),
      providerOptions: {
        openai: {
          textVerbosity: "low",
        },
      },
      system: `You are a helpful AI assistant that helps users understand the ${owner}/${repo} GitHub repository.
${details.description ? `\nDescription: ${details.description}` : ""}
${details.language ? `Primary language: ${details.language}` : ""}
${directories.length > 0 ? `\nDirectory structure:\n${directories.map((d) => `  ${d}/`).join("\n")}` : ""}

You have access to tools to search through the repository code and files. Use these tools to provide accurate, context-aware answers about the codebase.

When referencing code, always cite the file path. Keep your answers short (aim for less than 3 paragraphs) and focused on the user's question.

You can make at most 2 searches each time the user asks a question. Try to answer the question before hand. If you can't find the answer after 2 searches, succintly describe what you've found.`,
      messages: convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(10),
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      onError: (error: unknown) => {
        console.error("Chat error:", error);
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return `An error occurred: ${message}`;
      },
    });
  } catch (error) {
    console.error("Chat API Error:", error);
    const errorResponse: ErrorResponse = { error: "Internal Server Error" };
    return new Response(JSON.stringify(errorResponse), { status: 500 });
  }
}

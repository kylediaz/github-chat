import { ChromaClient, CloudClient } from "chromadb";
import {
  ChromaCloudQwenEmbeddingFunction,
  ChromaCloudQwenEmbeddingModel,
  ChromaCloudQwenEmbeddingTask,
} from "@chroma-core/chroma-cloud-qwen";
import { env } from "@/lib/env";
import { trace } from "@opentelemetry/api";
import {
  chromaDocumentMetadataSchema,
  type QueryResult,
  type CreateSourceResponse,
  type CreateInvocationResponse,
  type InvocationStatus,
  type InvocationStatusResponse,
  type NormalizedInvocationStatus,
} from "@/types/chroma";

const tracer = trace.getTracer("chroma");

const client = new CloudClient({
  apiKey: env.CHROMA_API_KEY,
  tenant: env.CHROMA_TENANT,
  database: env.CHROMA_DATABASE,
});

const qwenEf = new ChromaCloudQwenEmbeddingFunction({
  model: ChromaCloudQwenEmbeddingModel.QWEN3_EMBEDDING_0p6B,
  task: ChromaCloudQwenEmbeddingTask.NL_TO_CODE,
});

const SYNC_API_BASE = "https://sync.trychroma.com/api/v1";

const EMBEDDING_CONFIG = {
  dense: {
    model: "Qwen/Qwen3-Embedding-0.6B",
    task: null,
  },
  sparse: null,
} as const;

function normalizeStatus(
  status: InvocationStatusResponse["status"],
): InvocationStatus {
  if (typeof status === "string") {
    return status as InvocationStatus;
  }
  if ("complete" in status) {
    return "completed";
  }
  if ("failed" in status) {
    return "failed";
  }
  return "pending";
}

export async function queryCollection(
  collectionName: string,
  queryText: string,
  nResults: number = 10,
): Promise<QueryResult[]> {
  const span = tracer.startSpan("chroma.queryCollection");
  span.setAttributes({
    "collection.name": collectionName,
    "query.nResults": nResults,
    "query.length": queryText.length,
  });

  try {
    const collection = await client.getCollection({
      name: collectionName,
      embeddingFunction: qwenEf,
    });

    const results = await collection.query({
      queryTexts: [queryText],
      nResults,
    });

    const formattedResults: QueryResult[] = [];

    if (results.ids && results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const rawMetadata = results.metadatas?.[0]?.[i];
        const parseResult = rawMetadata
          ? chromaDocumentMetadataSchema.safeParse(rawMetadata)
          : null;
        const metadata = parseResult?.success ? parseResult.data : null;

        formattedResults.push({
          id: results.ids[0][i],
          distance: results.distances?.[0]?.[i] || 0,
          metadata: metadata!,
          document: results.documents?.[0]?.[i]!,
        });
      }
    }

    span.setAttribute("results.count", formattedResults.length);
    return formattedResults;
  } catch (error) {
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

export async function createSource(
  owner: string,
  repo: string,
): Promise<CreateSourceResponse> {
  const span = tracer.startSpan("chroma.createSource");
  span.setAttributes({
    "github.owner": owner,
    "github.repo": repo,
  });

  try {
    const response = await fetch(`${SYNC_API_BASE}/sources`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "x-chroma-token": env.CHROMA_API_KEY,
      },
      body: JSON.stringify({
        github: {
          include_globs: ["**/*"],
          repository: `${owner}/${repo}`,
        },
        database_name: env.CHROMA_DATABASE,
        embedding: EMBEDDING_CONFIG,
        embedding_model: null,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      span.recordException(
        new Error(`Failed to create Chroma source: ${errorText}`),
      );
      throw new Error(`Failed to create Chroma source: ${errorText}`);
    }

    const data: CreateSourceResponse = await response.json();
    span.setAttribute("source.id", data.source_id);
    return data;
  } catch (error) {
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

export async function createInvocation(
  sourceId: string,
  commitSha: string,
  collectionName: string,
): Promise<CreateInvocationResponse> {
  const span = tracer.startSpan("chroma.createInvocation");
  span.setAttributes({
    "source.id": sourceId,
    "commit.sha": commitSha.substring(0, 7),
    "collection.name": collectionName,
  });

  try {
    const response = await fetch(
      `${SYNC_API_BASE}/sources/${sourceId}/invocations`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "x-chroma-token": env.CHROMA_API_KEY,
        },
        body: JSON.stringify({
          ref_identifier: {
            sha: commitSha,
          },
          target_collection_name: collectionName,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      span.recordException(
        new Error(`Failed to create Chroma invocation: ${errorText}`),
      );
      throw new Error(`Failed to create Chroma invocation: ${errorText}`);
    }

    const data: CreateInvocationResponse = await response.json();
    span.setAttribute("invocation.id", data.invocation_id);
    return data;
  } catch (error) {
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

export async function getInvocationStatus(
  invocationId: string,
): Promise<NormalizedInvocationStatus> {
  const span = tracer.startSpan("chroma.getInvocationStatus");
  span.setAttribute("invocation.id", invocationId);

  try {
    const response = await fetch(
      `${SYNC_API_BASE}/invocations/${invocationId}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "x-chroma-token": env.CHROMA_API_KEY,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      span.recordException(
        new Error(`Failed to fetch invocation status: ${errorText}`),
      );
      throw new Error(`Failed to fetch invocation status: ${errorText}`);
    }

    const data: InvocationStatusResponse = await response.json();
    const normalizedStatus = normalizeStatus(data.status);

    span.setAttribute("invocation.status", normalizedStatus);

    return {
      id: data.id,
      status: normalizedStatus,
      created_at: data.created_at,
      metadata: data.metadata,
    };
  } catch (error) {
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}


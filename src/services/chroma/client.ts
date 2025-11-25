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

export async function queryCollection(
  collectionName: string,
  queryText: string,
  nResults: number = 10,
): Promise<QueryResult[]> {
  const span = tracer.startSpan("chroma.queryCollection");

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


import { NextRequest, NextResponse } from 'next/server';
import { db, githubSyncSources, githubSyncInvocations } from '@/db';
import { eq, and, desc } from 'drizzle-orm';
import { trace } from '@opentelemetry/api';
import { validateEnv } from '@/lib/env';
import { getInvocationStatus } from '@/lib/chroma';
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
    const source = await db.query.githubSyncSources.findFirst({
      where: and(
        eq(githubSyncSources.owner, owner),
        eq(githubSyncSources.repo, repo)
      ),
    });

    if (!source) {
      const errorResponse: ErrorResponse = { error: 'Repository not synced yet' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const latestInvocation = await db.query.githubSyncInvocations.findFirst({
      where: eq(githubSyncInvocations.sourceUuid, source.uuid),
      orderBy: [desc(githubSyncInvocations.createdAt)],
    });

    if (!latestInvocation) {
      const errorResponse: ErrorResponse = { error: 'No invocation found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    span.setAttribute('invocation.id', latestInvocation.invocationId);

    let statusData;
    try {
      statusData = await getInvocationStatus(latestInvocation.invocationId);
    } catch (error) {
      console.error('Failed to fetch invocation status:', error);
      span.recordException(error as Error);
      const errorResponse: ErrorResponse = { error: 'Failed to fetch invocation status' };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    const currentStatus = statusData.status;

    if (currentStatus !== latestInvocation.status) {
      await db.update(githubSyncInvocations)
        .set({ status: currentStatus })
        .where(eq(githubSyncInvocations.uuid, latestInvocation.uuid));

      span.addEvent('status_updated', {
        oldStatus: latestInvocation.status,
        newStatus: currentStatus,
      });
    }

    span.setAttribute('invocation.status', currentStatus);

    const response: StatusResponse = {
      sync_status: currentStatus,
      commit_sha: latestInvocation.commitSha,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error checking status:', error);
    span.recordException(error as Error);
    const errorResponse: ErrorResponse = { error: 'Failed to check status' };
    return NextResponse.json(errorResponse, { status: 500 });
  } finally {
    span.end();
  }
}


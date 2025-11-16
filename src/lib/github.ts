import { Octokit } from 'octokit';
import { env } from './env';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('github');

const octokit = new Octokit({
  auth: env.GITHUB_TOKEN,
});

export interface GitHubRepo {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  htmlUrl: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  watchersCount: number;
  openIssuesCount: number;
  subscribersCount: number;
  fork: boolean;
  private: boolean;
  licenseName: string | null;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  authorName: string;
  authorDate: Date;
  htmlUrl: string;
}

export interface GitHubError {
  private?: boolean;
  accessible?: boolean;
  notFound?: boolean;
}

export async function getRepository(
  owner: string,
  repo: string
): Promise<GitHubRepo | GitHubError | null> {
  const span = tracer.startSpan('github.getRepository');
  span.setAttributes({
    'github.owner': owner,
    'github.repo': repo,
  });
  
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}', {
      owner,
      repo,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    const data = response.data;
    
    span.setAttribute('repository.stars', data.stargazers_count);

    return {
      owner,
      repo,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      htmlUrl: data.html_url,
      language: data.language,
      stargazersCount: data.stargazers_count,
      forksCount: data.forks_count,
      watchersCount: data.watchers_count,
      openIssuesCount: data.open_issues_count,
      subscribersCount: data.subscribers_count || 0,
      fork: data.fork,
      private: data.private,
      licenseName: data.license?.name || null,
    };
  } catch (error: any) {
    if (error.status === 404) {
      span.setAttribute('error.type', 'not_found');
      return { notFound: true };
    }
    
    if (error.status === 403) {
      span.setAttribute('error.type', 'private_inaccessible');
      return { private: true, accessible: false };
    }
    
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

export async function getBranchCommit(
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubCommit | null> {
  const span = tracer.startSpan('github.getBranchCommit');
  span.setAttributes({
    'github.owner': owner,
    'github.repo': repo,
    'github.branch': branch,
  });
  
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
      owner,
      repo,
      branch,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    const commitData = response.data.commit;
    
    span.setAttribute('commit.sha', commitData.sha.substring(0, 7));

    return {
      sha: commitData.sha,
      message: commitData.commit.message,
      authorName: commitData.commit.author?.name || 'Unknown',
      authorDate: new Date(commitData.commit.author?.date || Date.now()),
      htmlUrl: commitData.html_url,
    };
  } catch (error: any) {
    if (error.status === 404) {
      span.setAttribute('error.type', 'branch_not_found');
      return null;
    }
    
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}


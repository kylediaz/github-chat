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
  treeSha: string;
  message: string;
  authorName: string;
  authorDate: Date;
  htmlUrl: string;
}

export interface GitHubTree {
  sha: string;
  url?: string;
  tree: Array<{
    path: string;
    mode: string;
    type: string;
    size?: number;
    sha: string;
    url?: string;
  }>;
  truncated: boolean;
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
    const treeSha = commitData.commit.tree.sha;
    
    span.setAttribute('commit.sha', commitData.sha.substring(0, 7));
    span.setAttribute('tree.sha', treeSha.substring(0, 7));

    return {
      sha: commitData.sha,
      treeSha,
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

export async function getRepositoryTree(
  owner: string,
  repo: string,
  treeSha: string,
  recursive: boolean = true,
): Promise<GitHubTree | null> {
  const span = tracer.startSpan('github.getRepositoryTree');
  span.setAttributes({
    'github.owner': owner,
    'github.repo': repo,
    'tree.sha': treeSha.substring(0, 7),
  });

  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
      owner,
      repo,
      tree_sha: treeSha,
      recursive: recursive ? 'true' : 'false',
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    const data = response.data;
    
    span.setAttribute('tree.entries_count', data.tree?.length || 0);

    return {
      sha: data.sha,
      url: data.url,
      tree: data.tree || [],
      truncated: data.truncated || false,
    };
  } catch (error: any) {
    if (error.status === 404) {
      span.setAttribute('error.type', 'tree_not_found');
      return null;
    }

    if (error.status === 403) {
      span.setAttribute('error.type', 'private_inaccessible');
      return null;
    }

    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}


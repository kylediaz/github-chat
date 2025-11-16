import type { TreeNode } from './github';

export interface RepoInfo {
  fullName: string;
  description: string | null;
  htmlUrl: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  watchersCount: number;
  openIssuesCount: number;
}

export interface RepoCheckResponse {
  exists: boolean;
  synced: boolean;
  sync_status: string | null;
  is_private: boolean;
  repo_info: RepoInfo | null;
}

export interface SyncResponse {
  status: 'pending' | 'up_to_date' | string;
}

type SyncStatus = 'pending' | 'up_to_date' | 'processing' | 'completed' | 'failed';

export interface StatusResponse {
  exists: boolean;
  synced: boolean;
  sync_status: string | null;
  is_private: boolean;
  repo_info: RepoInfo | null;
  commit_sha: string | null;
  tree: TreeNode | null;
}

export interface ErrorResponse {
  error: string;
}


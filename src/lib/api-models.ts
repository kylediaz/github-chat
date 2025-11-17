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


export type RepoSyncStatus = 'processing' | 'out_of_date' | 'up_to_date' | 'failed';

export interface SyncResponse {
  status: RepoSyncStatus;
}

export interface StatusResponse {
  exists: boolean;
  sync_status: RepoSyncStatus | null;
  is_private: boolean;
  repo_info: RepoInfo | null;
  commit_sha: string | null;
  tree: TreeNode | null;
}

export interface ErrorResponse {
  error: string;
}


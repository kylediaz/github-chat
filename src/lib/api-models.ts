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

export interface StatusResponse {
  sync_status: string;
  commit_sha: string;
}

export interface ErrorResponse {
  error: string;
}


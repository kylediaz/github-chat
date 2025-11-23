import { Octokit } from "octokit";
import { env } from "@/lib/env";
import { trace } from "@opentelemetry/api";
import type {
  GitHubRepo,
  GitHubCommit,
  GitHubTree,
  GitHubError,
  TreeNode,
} from "@/types/github";

const tracer = trace.getTracer("github");

const octokit = new Octokit({
  auth: env.GITHUB_TOKEN,
});

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)}${sizes[i]}`;
}

export function transformTreeToHierarchy(
  tree: GitHubTree["tree"],
  rootName: string = "root_directory",
): TreeNode | null {
  if (!tree || tree.length === 0) {
    return null;
  }

  const root: TreeNode = {
    name: rootName,
    type: "directory",
    children: [],
  };

  const pathMap = new Map<string, TreeNode>();
  pathMap.set("", root);

  for (const entry of tree) {
    const pathParts = entry.path.split("/");
    let currentPath = "";

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLast = i === pathParts.length - 1;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!pathMap.has(currentPath)) {
        const isDirectory = !isLast || entry.type === "tree";
        const node: TreeNode = {
          name: part,
          type: isDirectory ? "directory" : "file",
        };

        if (!isDirectory && entry.size !== undefined) {
          node.size = formatFileSize(entry.size);
        }

        if (isDirectory) {
          node.children = [];
        }

        pathMap.set(currentPath, node);

        const parent = pathMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(node);
        }
      }
    }
  }

  const sortChildren = (node: TreeNode) => {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      node.children.forEach(sortChildren);
    }
  };

  sortChildren(root);

  return root;
}

export async function getRepository(
  owner: string,
  repo: string,
): Promise<GitHubRepo | GitHubError> {
  const span = tracer.startSpan("github.getRepository");
  span.setAttributes({
    "github.owner": owner,
    "github.repo": repo,
  });

  try {
    const response = await octokit.request("GET /repos/{owner}/{repo}", {
      owner,
      repo,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    const data = response.data;

    span.setAttribute("repository.stars", data.stargazers_count);

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
      span.setAttribute("error.type", "not_found");
      return { notFound: true };
    }

    if (error.status === 403) {
      span.setAttribute("error.type", "private_inaccessible");
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
  branch: string,
): Promise<GitHubCommit | null> {
  const span = tracer.startSpan("github.getBranchCommit");
  span.setAttributes({
    "github.owner": owner,
    "github.repo": repo,
    "github.branch": branch,
  });

  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/branches/{branch}",
      {
        owner,
        repo,
        branch,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    const commitData = response.data.commit;
    const treeSha = commitData.commit.tree.sha;

    span.setAttribute("commit.sha", commitData.sha.substring(0, 7));
    span.setAttribute("tree.sha", treeSha.substring(0, 7));

    return {
      sha: commitData.sha,
      treeSha,
      message: commitData.commit.message,
      authorName: commitData.commit.author?.name || "Unknown",
      authorDate: new Date(commitData.commit.author?.date || Date.now()),
      htmlUrl: commitData.html_url,
    };
  } catch (error: any) {
    if (error.status === 404) {
      span.setAttribute("error.type", "branch_not_found");
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
  const span = tracer.startSpan("github.getRepositoryTree");
  span.setAttributes({
    "github.owner": owner,
    "github.repo": repo,
    "tree.sha": treeSha.substring(0, 7),
  });

  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      {
        owner,
        repo,
        tree_sha: treeSha,
        recursive: recursive ? "true" : "false",
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    const data = response.data;

    span.setAttribute("tree.entries_count", data.tree?.length || 0);

    return {
      sha: data.sha,
      url: data.url,
      tree: data.tree || [],
      truncated: data.truncated || false,
    };
  } catch (error: any) {
    if (error.status === 404) {
      span.setAttribute("error.type", "tree_not_found");
      return null;
    }

    if (error.status === 403) {
      span.setAttribute("error.type", "private_inaccessible");
      return null;
    }

    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}


import { GitHubTree, TreeNode } from "@/types/github";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

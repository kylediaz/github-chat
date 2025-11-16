"use client";

import { useState, FormEvent } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";

export default function Home() {
  const [repoUrl, setRepoUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const trimmedUrl = repoUrl.trim();
    
    // Comprehensive regex to match various GitHub URL formats:
    // - https://github.com/owner/repo
    // - http://github.com/owner/repo
    // - www.github.com/owner/repo
    // - github.com/owner/repo
    // - /owner/repo
    // - /owner/repo/
    // - owner/repo
    const repoPattern = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?\/?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?/i;
    const match = trimmedUrl.match(repoPattern);

    if (!match) {
      setError("Please enter a valid GitHub repository URL or owner/repo");
      setLoading(false);
      return;
    }

    const [, owner, repo] = match;
    
    // Remove any trailing slashes or fragments from repo name
    const cleanRepo = repo.split(/[\/?#]/)[0];
    
    if (!owner || !cleanRepo) {
      setError("Please enter a valid GitHub repository URL or owner/repo");
      setLoading(false);
      return;
    }

    router.push(`/${owner}/${cleanRepo}`);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-white px-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1}}
        transition={{ duration: 0.2 }}
        className="w-full max-w-2xl"
      >
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl md:text-5xl font-medium tracking-tight mb-4">
            Chat with any GitHub Repository
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="w-full">
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/chroma-core/chroma"
              className="w-full px-4 py-3 text-lg border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:border-transparent"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !repoUrl.trim()}
              className="w-full px-6 py-3 text-lg font-medium text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Loading..." : "Start Chatting"}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-red-600 text-sm">{error}</p>
          )}
        </form>
      </motion.div>
    </div>
  );
}
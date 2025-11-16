"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChat } from '@ai-sdk/react';
import { Message } from "@/components/message";
import { useScrollToBottom } from "@/components/use-scroll-to-bottom";
import { ChatInput } from "@/components/chat-input";
import { motion } from "framer-motion";
import { DefaultChatTransport } from "ai";
import { AnimatedEllipsis } from "@/components/misc";
import type { RepoCheckResponse, StatusResponse, ErrorResponse } from "@/lib/api-models";

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const owner = params.owner as string;
  const repo = params.repo as string;

  const [repoInfo, setRepoInfo] = useState<RepoCheckResponse | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [chatEnabled, setChatEnabled] = useState<boolean>(false);

  const { messages, sendMessage, status, error: chatError } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/chat/${owner}/${repo}`,
    }),
  });
  console.log(messages, status, chatError);

  const [input, setInput] = useState<string>("");
  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  const onSubmit = useMemo(() => async (inputValue: string) => {
    if (!chatEnabled) return;
    sendMessage({
      text: inputValue,
    });
    setInput("");
  }, [sendMessage, setInput, chatEnabled]);

  useEffect(() => {
    async function checkAndSync() {
      try {
        const checkResponse = await fetch(`/api/repos/${owner}/${repo}/check`);
        const checkData: RepoCheckResponse = await checkResponse.json();

        setRepoInfo(checkData);

        if (!checkData.exists || checkData.is_private) {
          const syncResponse = await fetch(`/api/repos/${owner}/${repo}/sync`, {
            method: 'POST',
          });

          if (!syncResponse.ok) {
            const errorData: ErrorResponse = await syncResponse.json();
            setError(errorData.error || 'Failed to sync repository');
            return;
          }
        }

        if (checkData.synced && checkData.sync_status === 'completed') {
          setChatEnabled(true);
          setSyncStatus('completed');
        } else {
          if (!checkData.synced || checkData.sync_status === 'pending' || checkData.sync_status === 'running') {
            const syncResponse = await fetch(`/api/repos/${owner}/${repo}/sync`, {
              method: 'POST',
            });

            if (!syncResponse.ok) {
              const errorData: ErrorResponse = await syncResponse.json();
              setError(errorData.error || 'Failed to start sync');
              return;
            }
          }

          setIsPolling(true);
        }
      } catch (err) {
        console.error('Error:', err);
        setError('Failed to check repository status');
      }
    }

    checkAndSync();
  }, [owner, repo]);

  useEffect(() => {
    if (!isPolling) return;

    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await fetch(`/api/repos/${owner}/${repo}/status`);
        const statusData: StatusResponse = await statusResponse.json();

        setSyncStatus(statusData.sync_status);
        setCommitSha(statusData.commit_sha);

        if (statusData.sync_status === 'completed') {
          setChatEnabled(true);
          setIsPolling(false);
        } else if (statusData.sync_status === 'failed') {
          setError('Sync failed. Please try again.');
          setIsPolling(false);
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [isPolling, owner, repo]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-4">
        <div className="max-w-md text-center">
          <h2 className="text-2xl font-semibold text-red-600 mb-4">Error</h2>
          <p className="text-zinc-600 mb-6">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="max-w-xl min-h-14 px-4 mx-auto flex items-center justify-between">
          <div className="flex-1">
            {repoInfo?.repo_info && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-semibold text-zinc-900">
                    {repoInfo.repo_info.fullName}
                  </h1>
                </div>
                <div className="flex items-center gap-4 text-sm text-zinc-500">
                  <span>★ {repoInfo.repo_info.stargazersCount.toLocaleString()}</span>
                  <span>Ψ {repoInfo.repo_info.forksCount.toLocaleString()}</span>
                  {commitSha && (
                    <a
                      href={`${repoInfo.repo_info.htmlUrl}/commit/${commitSha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-zinc-700 underline"
                    >
                      {commitSha.substring(0, 7)}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 border border-neutral-200 rounded-lg hover:border-neutral-300 transition-colors"
          >
            Change Repo
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-scroll">
        <div
          ref={messagesContainerRef}
          className="py-8"
        >
          <div className="w-full max-w-xl flex flex-col items-start gap-3 mx-auto px-4">
            {messages.length === 0 && chatEnabled && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-xl"
              >
                <div className="rounded-lg p-6 bg-zinc-50">
                  <h2 className="font-medium mb-2">
                    Ready to chat with {owner}/{repo}
                  </h2>
                  <p className="text-zinc-600">
                    Ask questions about the codebase, architecture, or specific features.
                  </p>
                </div>
              </motion.div>
            )}
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {status === "submitted" && (
              <div className="text-gray-500 font-serif px-3 text-lg">
                Thinking<AnimatedEllipsis />
              </div>
            )}
            {status === "error" && chatError && (
              <div className="text-red-500">
                Error: {chatError?.message}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <div className="pb-4 px-4">
        <div className="max-w-4xl mx-auto">
          <ChatInput
            input={input}
            setInput={setInput}
            onSubmit={onSubmit}
            disabled={!chatEnabled}
          />
        </div>
      </div>
    </div>
  );
}


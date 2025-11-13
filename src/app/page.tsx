"use client";

import { ReactNode, useMemo, useState } from "react";
import { useChat } from '@ai-sdk/react';
import { Message } from "@/components/message";
import { useScrollToBottom } from "@/components/use-scroll-to-bottom";
import { ChatInput } from "@/components/chat-input";
import { motion } from "framer-motion";
import Link from "next/link";
import { DefaultChatTransport } from "ai";
import { AnimatedEllipsis } from "@/components/misc";

interface SuggestedAction {
  title: string;
  label: string;
  action: string;
}

export default function Home() {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
  });

  const [input, setInput] = useState<string>("");

  const onSubmit = useMemo(() => async (inputValue: string) => {
    sendMessage({
      text: inputValue,
    });
    setInput("");
  }, [sendMessage, setInput]);

  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  const suggestedActions: SuggestedAction[] = [
    { title: "npm/ai", label: "How do I stream responses with AI SDK?", action: "In npm AI SDK, how do I stream responses?" },
    { title: "pypi/sqlalchemy", label: "When does ORM relationship loading choose selectin vs. joined vs. subquery", action: "In SQLAlchemy, when does ORM relationship loading choose selectin vs. joined vs. subquery" },
    {
      title: "pypi/numpy", 
      label: "What environment variables or compile-time flags switch kernels",
      action: "In numpy, what environment variables or compile-time flags switch kernels?"
    },
    {
      title: "crates/actix",
      label: "Actor supervision and child actor management",
      action: "In Actix, how can actors supervise and manage child actors? What supervision strategies are available?"
    },
    {
      title: "pypi/httpx",
      label: "Connection pools and HTTP/2 multiplexing connection selection",
      action: "In httpx, how do connection pools and HTTP/2 multiplexing actually select connections under limits?"
    },
    {
      title: "pypi/jax",
      label: "Array API compliance behavioral differences",
      action: "For Array API compliance, what behavioral differences (type promotion, nan semantics, out-of-place ops) must a library document?"
    }
  ];

  const backgrounds = [
    "asset/background/1.png",
    "asset/background/2.png",
    "asset/background/3.png",
    "asset/background/4.png",
  ];

  return (
    <div className="flex flex-col justify-between pb-20 h-dvh bg-white">
      <div className="flex flex-col justify-between overflow-y-scroll">
        <div
          ref={messagesContainerRef}
          className="py-20"
        >
          <div className="w-lg flex flex-col items-start gap-3 mx-auto">
            {messages.length === 0 && (
              <motion.div className="px-4 w-full md:px-0">
                <div className="rounded-xs p-6 flex flex-col gap-6">
                  <h1 className="font-display text-pretty text-4xl font-medium tracking-tight">
                    Expert-Level Knowledge on any open-source library
                  </h1>
                  <div className="flex flex-col gap-2">
                    <p>
                      LLMs have knowledge cutoffs based on their training data.
                    </p>
                    <p>
                      Chroma indexed 18,000+ codebases to create an MCP that provides your code agent
                      up-to-date knowledge on any open-source library or SDK.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
            <div className="grid gap-2 w-full px-4 md:px-0 mx-auto mb-4">
              {messages.length === 0 &&
                suggestedActions.map((action, index) => (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.01 * index }}
                    key={index}
                    className={index > 1 ? "hidden sm:block" : "block"}
                  >
                    <button
                      onClick={() => onSubmit(action.action)}
                      className="w-full text-left border border-neutral-400 text-zinc-800 rounded-lg p-2 text-sm relative overflow-hidden transition-colors flex flex-col group hover:bg-neutral-100"
                    >
                      <div className={`absolute inset-0 opacity-0 transition-opacity duration-400 group-hover:bg-gray-100`} />
                      <span className="font-medium relative z-10">{action.title}</span>
                      <span className="text-zinc-500 dark:text-zinc-400 relative z-10">
                        {action.label}
                      </span>
                    </button>
                  </motion.div>
                ))}
            </div>
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {status === "submitted" && (
              <div className="text-gray-500 font-serif px-3 text-lg">
                Thinking<AnimatedEllipsis />
              </div>
            )}
            {status === "error" && (
              <div className="text-red-500">
                Error: {error?.message}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <div className="mt-[-10px] w-lg mx-auto">
        <ChatInput
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}
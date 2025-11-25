import { ReactNode, useState } from "react";
import { UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";
import { motion } from "framer-motion";

import { CodeBlock } from "@/components/chat/code-block";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning";
import { MemoizedMarkdown } from "@/components/chat/memoized-markdown";
import { useWindows } from "@/contexts/window-context";
import { ToolCallWindow } from "@/components/windows/tool-call-window";
import { AnimatedEllipsis } from "@/components/shared/misc";

const MAX_VISIBLE_RESULTS = 6;

export interface MessageProps {
  message: UIMessage;
}

function parseToolOutput(output: any): { searchResults: any | null } {
  if (output?.results && Array.isArray(output.results)) {
    return { searchResults: { results: output.results } };
  }
  return { searchResults: null };
}

function formatParameterValue(value: any): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

export function Message({ message }: MessageProps): ReactNode {
  const { role } = message;

  if (role === "user") {
    return <UserMessage message={message} />;
  }

  if (role === "assistant") {
    return <AssistantMessage message={message} />;
  }

  return null;
}

function UserMessage({ message }: { message: UIMessage }) {
  return (
    <div className="min-w-[4ch] py-2 px-3 rounded-md bg-secondary border-[.1px] border-border mt-8">
      {message.parts.map((part, index) =>
        part.type === "text" ? (
          <MemoizedMarkdown
            key={`${message.id}-${index}`}
            id={`${message.id}-${index}`}
            content={part.text}
          />
        ) : null,
      )}
    </div>
  );
}

function AssistantMessage({ message }: { message: UIMessage }) {
  return (
    <div className="w-full px-3 font-serif text-lg">
      <MessageContent parts={message.parts} />
    </div>
  );
}

function MessageContent({
  parts,
}: {
  parts: UIMessagePart<UIDataTypes, UITools>[];
}) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "step-start") {
          return null;
        }

        if (typeof part.type === "string" && part.type.startsWith("tool-")) {
          return <ToolInvocation key={index} part={part} />;
        }

        switch (part.type) {
          case "text":
            return (
              <MemoizedMarkdown
                key={index}
                id={`content-${index}`}
                content={part.text}
              />
            );
          case "reasoning":
            return (
              <Reasoning key={index}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );
          case "dynamic-tool":
            return <ToolInvocation key={index} part={part} />;
          case "tool-formatCode":
            const { language, code } =
              "input" in part
                ? (part.input as { language: string; code: string })
                : { language: "", code: "" };
            return <CodeBlock key={index} code={code} language={language} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function ToolInvocation({
  part,
}: {
  part: UIMessagePart<UIDataTypes, UITools>;
}) {
  const partAny = part as any;
  const toolName =
    typeof part.type === "string" && part.type.startsWith("tool-")
      ? part.type.replace("tool-", "")
      : partAny.toolName || "unknown";
  const input = partAny.input;
  const output = partAny.output;
  const toolCallId = partAny.toolCallId;
  const state = partAny.state;

  const { openWindow } = useWindows();

  const { searchResults } = parseToolOutput(output);
  const isLoading = !output || state !== "output-available" || !searchResults;

  const handleToolCallClick = () => {
    openWindow({
      title: `${toolName} - Tool Call Details`,
      content: (
        <ToolCallWindow toolName={toolName} input={input} output={output} />
      ),
      x: 650,
      y: 100,
      width: 400,
      height: 600,
      isMinimized: false,
      isMaximized: false,
    });
  };

  return (
    <div key={toolCallId} className="mb-2">
      {input && (
        <div
          className="font-mono text-sm flex flex-row items-center cursor-pointer hover:underline max-w-full"
          onClick={handleToolCallClick}
        >
          <div className="font-medium shrink-0">{toolName}</div>
          <div className="shrink-0">{"("}</div>
          <ToolCallParameters input={input} />
          <div className="shrink-0">{")"}</div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-row gap-[1ch] font-mono text-sm">
          <span>⎿</span>
          <AnimatedEllipsis className="font-mono" />
        </div>
      ) : (
        searchResults && <SearchResults results={searchResults} />
      )}
    </div>
  );
}

function ToolCallParameters({ input }: { input: Record<string, any> }) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const params = Object.entries(input);

  if (params.length === 0) {
    return null;
  }

  return (
    <div className="font-mono text-sm overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
      {params.map(([key, value], index) => (
        <span key={key}>
          {formatParameterValue(value)}
          {index < params.length - 1 && ", "}
        </span>
      ))}
    </div>
  );
}

function SearchResults({ results }: { results: any }) {
  const { openWindow } = useWindows();
  const [showAll, setShowAll] = useState(false);

  if (!results?.results?.length) {
    return <div>No search results found</div>;
  }

  const resultsArray = results.results;
  const visibleResults = showAll
    ? resultsArray
    : resultsArray.slice(0, MAX_VISIBLE_RESULTS);
  const hiddenCount = resultsArray.length - MAX_VISIBLE_RESULTS;

  const handleResultClick = (result: any, index: number) => {
    const fileName =
      (result.path || "unknown").split("/").pop() || "Unknown File";

    openWindow({
      title: fileName,
      content: (
        <div className="flex flex-col h-full bg-white">
          <div className="flex-1 overflow-auto p-4 bg-white">
            <div className="font-mono text-sm space-y-2">
              <div className="text-gray-600 mb-4">
                <div>{result.path || "unknown"}</div>
                {result.relevanceScore !== undefined && (
                  <div className="text-xs">
                    Relevance: {result.relevanceScore.toFixed(4)}
                  </div>
                )}
              </div>
              <CodeBlock code={result.content || ""} language="text" />
            </div>
          </div>
        </div>
      ),
      x: 550 + index * 30,
      y: 50 + index * 30,
      width: 350,
      height: 600,
      isMinimized: false,
      isMaximized: false,
    });
  };

  return (
    <div className="flex flex-row gap-[1ch] font-mono text-sm max-w-full">
      <span className="shrink-0">⎿</span>
      <div className="flex-1 min-w-0">
        {visibleResults.map((result: any, index: number) => {
          const shouldAnimate = !showAll || index < MAX_VISIBLE_RESULTS;
          const ResultComponent = shouldAnimate ? motion.div : "div";
          const animationProps = shouldAnimate
            ? {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: { delay: index * 0.05, duration: 0.01 },
              }
            : {};

          return (
            <ResultComponent
              key={index}
              className="truncate w-full cursor-pointer hover:underline"
              onClick={() => handleResultClick(result, index)}
              {...animationProps}
            >
              {result.path || "unknown"}
            </ResultComponent>
          );
        })}

        {!showAll && hiddenCount > 0 && (
          <motion.div
            className="cursor-pointer hover:underline text-gray-500"
            onClick={() => setShowAll(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: visibleResults.length * 0.05, duration: 0.01 }}
          >
            and {hiddenCount} more...
          </motion.div>
        )}
      </div>
    </div>
  );
}


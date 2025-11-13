import { ReactNode, useState } from "react";
import { UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";
import { motion } from "framer-motion";

import { CodeBlock } from "./code-block";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning";
import { MemoizedMarkdown } from "./memoized-markdown";
import { useWindows } from "@/contexts/window-context";
import { SearchResultWindow } from "@/components/windows/search-result-window";
import { ToolCallWindow } from "@/components/windows/tool-call-window";
import { SearchResult, SearchResultsData, GroupedSearchResult, ReadFileResult } from "@/lib/models";

// Constants
const MAX_VISIBLE_RESULTS = 6;
const PARAMETER_ORDER = ['registry_name', 'package_name', 'pattern', 'semantic_queries', 'filename_sha256'];

// Types
export interface MessageProps {
  message: UIMessage;
}

// Helper functions
function parseToolOutput(output: any, toolName: string): { searchResults: SearchResultsData | null; readFileResult: ReadFileResult | null } {
  if (!output?.content?.[0]?.text) {
    return { searchResults: null, readFileResult: null };
  }

  try {
    const parsedOutput = JSON.parse(output.content[0].text);
    if (toolName === 'package_search_read_file') {
      return { searchResults: null, readFileResult: parsedOutput as ReadFileResult };
    }
    return { searchResults: parsedOutput, readFileResult: null };
  } catch (e) {
    return { searchResults: null, readFileResult: null };
  }
}

function formatParameterValue(key: string, value: any): string {
  if (key === 'pattern') {
    const pattern = String(value);
    const truncatedPattern = pattern.length > 10 ? pattern.substring(0, 10) + '...' : pattern;
    return `/${truncatedPattern}/g`;
  }
  
  if (key === 'filename_sha256') {
    const sha256 = String(value);
    return `"${sha256.substring(0, 5)}..."`;
  }
  
  if (Array.isArray(value)) {
    return `"${JSON.stringify(value)}"`;
  }
  
  return `"${String(value)}"`;
}

function groupSearchResults(results: SearchResult[]): GroupedSearchResult[] {
  const grouped = results.reduce((acc: Record<string, GroupedSearchResult>, item: SearchResult) => {
    const hash = item.result.filename_sha256;
    
    if (!acc[hash]) {
      acc[hash] = {
        filename_sha256: item.result.filename_sha256,
        file_path: item.result.file_path,
        language: item.result.language,
        snippets: []
      };
    }
    
    acc[hash].snippets.push({
      content: item.result.content,
      start_line: item.result.start_line,
      end_line: item.result.end_line
    });
    
    return acc;
  }, {});

  return Object.values(grouped);
}

// Components
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
        part.type === 'text' ? (
          <MemoizedMarkdown 
            key={`${message.id}-${index}`}
            id={`${message.id}-${index}`}
            content={part.text}
          />
        ) : null
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

function MessageContent({ parts }: { parts: UIMessagePart<UIDataTypes, UITools>[] }) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.type) {
          case 'text':
            return (
              <MemoizedMarkdown 
                key={index}
                id={`content-${index}`}
                content={part.text}
              />
            );
          case 'reasoning':
            return (
              <Reasoning key={index}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );
          case 'dynamic-tool':
            return <ToolInvocation key={index} part={part} />;
          case 'tool-formatCode':
            const { language, code } = "input" in part ? part.input as { language: string, code: string } : { language: "", code: "" };
            return <CodeBlock key={index} code={code} language={language} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function ToolInvocation({ part }: { part: UIMessagePart<UIDataTypes, UITools> }) {
  const { input, output, toolName, toolCallId } = part as any;
  const { openWindow } = useWindows();
  
  const { searchResults, readFileResult } = parseToolOutput(output, toolName);

  const handleToolCallClick = () => {
    openWindow({
      title: `${toolName} - Tool Call Details`,
      content: <ToolCallWindow toolName={toolName} input={input} output={output} />,
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
          className="font-mono text-sm flex flex-row cursor-pointer hover:underline"
          onClick={handleToolCallClick}
        >
          <div className="font-medium">{toolName}</div>
          {"("}
          <ToolCallParameters input={input} />
          {")"}
        </div>
      )}
      
      {searchResults && <SearchResults results={searchResults} />}
      {readFileResult && <ReadFileDisplay result={readFileResult} />}
    </div>
  );
}

function ToolCallParameters({ input }: { input: Record<string, string> }) {
  const orderedParams = PARAMETER_ORDER
    .filter(key => input[key] !== undefined)
    .map(key => [key, formatParameterValue(key, input[key])] as [string, string]);

  return (
    <div className="font-mono flex flex-row flex-wrap gap-1 text-sm">
      {orderedParams.map(([key, value], index) => (
        <span key={key}>
          {value}
          {index < orderedParams.length - 1 && ", "}
        </span>
      ))}
    </div>
  );
}

function SearchResults({ results }: { results: SearchResultsData }) {
  const { openWindow } = useWindows();
  const [showAll, setShowAll] = useState(false);
  
  if (!results?.results?.length) {
    return <div>No search results found</div>;
  }

  const groupedResultsArray = groupSearchResults(results.results);
  const visibleResults = showAll ? groupedResultsArray : groupedResultsArray.slice(0, MAX_VISIBLE_RESULTS);
  const hiddenCount = groupedResultsArray.length - MAX_VISIBLE_RESULTS;

  const handleResultClick = (groupedResult: GroupedSearchResult, index: number) => {
    const fileName = groupedResult.file_path.split('/').pop() || 'Unknown File';
    const snippetCount = groupedResult.snippets.length;
    const snippetText = snippetCount === 1 ? '1 snippet' : `${snippetCount} snippets`;
    
    openWindow({
      title: `${fileName} (${snippetText})`,
      content: <SearchResultWindow groupedResult={groupedResult} />,
      x: 550 + (index * 30),
      y: 50 + (index * 30),
      width: 350,
      height: 600,
      isMinimized: false,
      isMaximized: false,
    });
  };

  return (
    <div className="flex flex-row gap-[1ch] font-mono text-sm">
      <span>⎿</span>
      <div>
        {visibleResults.map((groupedResult, index) => {
          const shouldAnimate = !showAll || index < MAX_VISIBLE_RESULTS;
          const ResultComponent = shouldAnimate ? motion.div : 'div';
          const animationProps = shouldAnimate ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            transition: { delay: index * 0.05, duration: 0.01 }
          } : {};
          
          return (
            <ResultComponent
              key={groupedResult.filename_sha256}
              className="truncate max-w-[50ch] cursor-pointer hover:underline"
              onClick={() => handleResultClick(groupedResult, index)}
              {...animationProps}
            >
              {groupedResult.file_path}
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

function ReadFileDisplay({ result }: { result: ReadFileResult }) {
  const { openWindow } = useWindows();
  
  const handleFileClick = () => {
    const fileName = result.file_path.split('/').pop() || 'Unknown File';
    
    openWindow({
      title: fileName,
      content: (
        <div className="flex flex-col h-full bg-white">
          <div className="flex-1 overflow-auto p-4 bg-white">
            <div className="font-mono text-sm space-y-2">
              <div className="text-gray-600 mb-4">
                <div>{result.file_path}</div>
              </div>
              <CodeBlock code={result.content} language="text" />
            </div>
          </div>
        </div>
      ),
      x: 550,
      y: 50,
      width: 350,
      height: 500,
      isMinimized: false,
      isMaximized: false,
    });
  };

  const lines = result.end_line - result.start_line + 1;
  
  return (
    <div className="flex flex-row gap-[1ch] font-mono text-sm">
      <span>⎿</span>
      <div 
        className="truncate max-w-[50ch] cursor-pointer hover:underline"
        onClick={handleFileClick}
      >
        Read {lines} lines of {result.file_path}
      </div>
    </div>
  );
}
"use client";

import React from 'react';
import { CodeBlock } from '@/components/code-block';
import { GroupedSearchResult } from '@/lib/models';

interface SearchResultWindowProps {
  groupedResult: GroupedSearchResult;
}

export function SearchResultWindow({ groupedResult }: SearchResultWindowProps) {
  // Sort snippets by start line number
  const sortedSnippets = [...groupedResult.snippets].sort((a, b) => a.start_line - b.start_line);
  
  // Combine consecutive snippets
  const combinedSnippets = sortedSnippets.reduce((acc, snippet) => {
    if (acc.length === 0) {
      acc.push(snippet);
      return acc;
    }
    
    const lastSnippet = acc[acc.length - 1];
    
    // Check if current snippet is consecutive to the last one
    if (snippet.start_line <= lastSnippet.end_line + 1) {
      // Combine the snippets
      const combinedContent = lastSnippet.content + '\n' + snippet.content;
      acc[acc.length - 1] = {
        content: combinedContent,
        start_line: lastSnippet.start_line,
        end_line: Math.max(lastSnippet.end_line, snippet.end_line)
      };
    } else {
      // Add as separate snippet
      acc.push(snippet);
    }
    
    return acc;
  }, [] as typeof sortedSnippets);
  
  return (
    <div className="flex flex-col h-full">
      {/* Header with file info */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="font-semibold text-sm truncate" title={groupedResult.file_path}>
        {groupedResult.file_path}
        </h3>
      </div>
      
      {/* Code snippets */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {combinedSnippets.map((snippet, index) => (
            <CodeBlock 
                key={index}
                code={snippet.content} 
                language={groupedResult.language.toLowerCase()} 
                showLineNumbers={true}
                startingLineNumber={snippet.start_line}
            />
          ))}
        </div>
        
        {/* Additional metadata */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div>
              <div className="font-medium text-gray-700 mb-1">Language:</div>
              <div className="font-mono text-xs p-2 rounded-xs border max-h-20 overflow-y-auto capitalize">
                {groupedResult.language}
              </div>
            </div>
            <div>
              <div className="font-medium text-gray-700 mb-1">File Hash:</div>
              <div className="font-mono text-xs p-2 rounded-xs border max-h-20 overflow-y-auto break-all whitespace-nowrap">
                {groupedResult.filename_sha256}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

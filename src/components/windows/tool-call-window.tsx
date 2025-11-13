"use client";

import React from 'react';

interface ToolCallWindowProps {
  toolName: string;
  input: Record<string, any>;
  output?: any;
}

interface ToolConfig {
  title: string;
  description: string;
  parameters: Array<{
    key: string;
    label?: string;
    formatter?: (value: any) => React.ReactNode;
    condition?: (input: Record<string, any>) => boolean;
  }>;
}

const TOOL_CONFIGS: Record<string, ToolConfig> = {
  package_search_grep: {
    title: '# package_search_grep',
    description: 'Searches for exact pattern matches within package code using regular expressions.',
    parameters: [
      { key: 'registry_name' },
      { key: 'package_name' },
      { key: 'pattern', formatter: (value) => <span className="break-all">/{value}/g</span> },
      { key: 'head_limit', condition: (input) => !!input.head_limit },
    ],
  },
  package_search_hybrid: {
    title: '# package_search_hybrid',
    description: 'Combines semantic search with pattern matching for more intelligent code discovery',
    parameters: [
      { key: 'registry_name' },
      { key: 'package_name' },
      {
        key: 'semantic_queries',
        condition: (input) => !!input.semantic_queries,
        formatter: (value) => (
          <div>
            {Array.isArray(value) ? (
              value.map((query: string, index: number) => (
                <div key={index}>- {query}</div>
              ))
            ) : (
              <div>{String(value)}</div>
            )}
          </div>
        ),
      },
      { 
        key: 'pattern', 
        condition: (input) => !!input.pattern,
        formatter: (value) => <span className="break-all">/{value}/g</span>
      },
      { key: 'head_limit', condition: (input) => !!input.head_limit },
    ],
  },
  package_search_read_file: {
    title: '# package_search_read_file',
    description: 'Reads specific lines from a file in a package using its SHA256 hash',
    parameters: [
      { key: 'registry_name' },
      { key: 'package_name' },
      { key: 'filename_sha256', label: 'File SHA256' },
      { key: 'start_line', condition: (input) => !!input.start_line },
      { key: 'end_line', condition: (input) => !!input.end_line },
    ],
  },
};

export function ToolCallWindow({ toolName, input, output }: ToolCallWindowProps) {
  const config = TOOL_CONFIGS[toolName];

  if (config) {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="flex-1 overflow-auto p-4 bg-white">
          <div className="font-mono text-sm space-y-2">
            <div className="text-black font-medium">{config.title}</div>
            <div className="text-black">{config.description}</div>
            
            <div className="mt-4">
              {config.parameters.map(({ key, label, formatter, condition }) => {
                if (condition && !condition(input)) return null;
                
                const value = input[key];
                if (value === undefined) return null;
                
                return (
                  <div key={key}>
                    <div className="text-black font-medium">{label || key}:</div>
                    <div className="ml-4 text-black">
                      {formatter ? formatter(value) : (value || 'N/A')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for unknown tools
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-auto p-4 bg-white">
        <div className="font-mono text-sm space-y-2">
          <div className="text-blue-600"># {toolName}</div>
          <div className="text-gray-600"># Tool call details and parameters</div>
          
          <div className="mt-4">
            <div className="text-green-600">input:</div>
            <div className="ml-4 text-black">
              <pre className="text-sm overflow-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SearchResult {
  output_mode: string;
  result: {
    content: string;
    filename_sha256: string;
    file_path: string;
    language: string;
    start_line: number;
    end_line: number;
  };
}

export interface CodeSnippet {
  content: string;
  start_line: number;
  end_line: number;
}

export interface GroupedSearchResult {
  filename_sha256: string;
  file_path: string;
  language: string;
  snippets: CodeSnippet[];
}

export interface SearchResultsData {
  version_used: string;
  results: SearchResult[];
  truncation_message?: string;
}

export interface ReadFileResult {
  version_used: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  total_lines: number;
}

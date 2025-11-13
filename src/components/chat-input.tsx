"use client";

import { useRef } from "react";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (input: string) => Promise<void>;
}

export function ChatInput({ input, setInput, onSubmit }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDisabled = input.trim() === "";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isDisabled) {
      await onSubmit(input);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isDisabled) {
        handleSubmit(event);
      }
    }
  };

  return (
    <form 
      className="px-4 pb-4 mx-auto w-full max-w-xl bg-white sm:px-0"
      onSubmit={handleSubmit}
    >
      <div className="relative w-full pt-4">
        <textarea
          ref={textareaRef}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-16 border px-3 py-2 text-base outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-none bg-secondary w-full rounded-lg pr-12 pt-4 pb-16"
          autoFocus
          placeholder="Ask anything..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        
        <button
          type="submit"
          disabled={isDisabled}
          className="absolute right-2 bottom-2 rounded-lg p-2 bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed transition-colors"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            className="lucide lucide-arrow-up h-4 w-4 text-white"
          >
            <path d="m5 12 7-7 7 7"></path>
            <path d="M12 19V5"></path>
          </svg>
        </button>
      </div>
    </form>
  );
}

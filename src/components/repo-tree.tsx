"use client";

import { useState, useEffect, useRef } from "react";
import type { TreeNode } from "@/lib/github";
import { cn } from "@/lib/utils";

interface RepoTreeProps {
  tree: TreeNode;
  className?: string;
  previewLineCount?: number;
}

function collectFilePaths(
  node: TreeNode,
  currentPath: string = "",
  isRoot: boolean = true
): { path: string; size?: string }[] {
  const files: { path: string; size?: string }[] = [];
  
  // Skip the root node name, start building paths from its children
  if (isRoot) {
    if (node.type === 'directory' && node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        files.push(...collectFilePaths(child, "", false));
      });
    }
  } else {
    const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
    
    if (node.type === 'file') {
      files.push({
        path: fullPath,
        size: node.size,
      });
    }
    
    if (node.type === 'directory' && node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        files.push(...collectFilePaths(child, fullPath, false));
      });
    }
  }
  
  return files;
}

export function RepoTree({ tree, className, previewLineCount = 6 }: RepoTreeProps) {
  const filePaths = collectFilePaths(tree).sort((a, b) => a.path.localeCompare(b.path));
  const totalLines = filePaths.length;
  const [lineOffset, setLineOffset] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const scrollAccumulatorRef = useRef(0);
  
  // Calculate based on current offset
  const hasMoreAbove = lineOffset > 0;
  const defaultLinesToShow = previewLineCount;
  
  // When both "..." are shown, show one less line to compensate
  const wouldHaveMoreBelow = lineOffset + defaultLinesToShow < totalLines;
  const linesToShow = hasMoreAbove && wouldHaveMoreBelow 
    ? previewLineCount - 1 
    : previewLineCount;
  
  // Now recalculate hasMoreBelow with the actual linesToShow
  const hasMoreBelow = lineOffset + linesToShow < totalLines;
  
  const maxOffset = Math.max(0, totalLines - linesToShow);
  const clampedOffset = Math.min(lineOffset, maxOffset);
  const visibleLines = filePaths.slice(clampedOffset, clampedOffset + linesToShow);

  useEffect(() => {
    const treeElement = treeRef.current;
    if (!treeElement) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const scrollDelta = e.deltaY;
      scrollAccumulatorRef.current += scrollDelta;
      
      const lineHeight = 24;
      const linesToMove = Math.floor(Math.abs(scrollAccumulatorRef.current) / lineHeight);
      
      if (linesToMove > 0) {
        const direction = scrollAccumulatorRef.current > 0 ? 1 : -1;
        
        setLineOffset((prev) => {
          const newOffset = prev + (direction * linesToMove);
          const totalLinesCount = totalLines;
          
          // Recalculate for the new offset
          const willHaveMoreAbove = newOffset > 0;
          const willHaveMoreBelow = newOffset + defaultLinesToShow < totalLinesCount;
          const willShowBothIndicators = willHaveMoreAbove && willHaveMoreBelow;
          const effectiveLinesToShow = willShowBothIndicators 
            ? previewLineCount - 1 
            : previewLineCount;
          
          const maxOffset = Math.max(0, totalLinesCount - effectiveLinesToShow);
          const clampedOffset = Math.max(0, Math.min(newOffset, maxOffset));
          
          scrollAccumulatorRef.current = scrollAccumulatorRef.current % lineHeight;
          
          return clampedOffset;
        });
      }
    };

    treeElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => treeElement.removeEventListener('wheel', handleWheel);
  }, [totalLines, previewLineCount, defaultLinesToShow]);

  return (
    <div ref={treeRef} className={cn(className)}>
      <div className="font-mono text-sm leading-relaxed">
        {hasMoreAbove && (
          <div className="whitespace-pre">...</div>
        )}
        {visibleLines.map((item, index) => {
          const actualIndex = clampedOffset + index;
          const isLastInList = actualIndex === totalLines - 1;
          const prefix = isLastInList ? "└── " : "├── ";
          const displayPath = prefix + item.path;
          
          if (item.size) {
            return (
              <div key={actualIndex} className="flex items-center whitespace-pre">
                <span className="flex-1">{displayPath}</span>
                <span className="text-right ml-auto">({item.size})</span>
              </div>
            );
          }
          return (
            <div key={actualIndex} className="whitespace-pre">
              {displayPath}
            </div>
          );
        })}
        {hasMoreBelow && (
          <div className="whitespace-pre">...</div>
        )}
      </div>
    </div>
  );
}


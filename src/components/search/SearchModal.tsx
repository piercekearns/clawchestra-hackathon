import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ModalDragZone } from '../ui/ModalDragZone';
import Fuse from 'fuse.js';
import type { ProjectViewModel, RoadmapItem } from '../../lib/schema';
import { SearchResultItem } from './SearchResultItem';

export interface SearchableRoadmapItem extends RoadmapItem {
  /** Parent project ID */
  projectId: string;
  /** Parent project title (for display) */
  projectTitle: string;
}

export type SearchResult =
  | { type: 'project'; item: ProjectViewModel }
  | { type: 'roadmap'; item: SearchableRoadmapItem };

interface SearchModalProps {
  isOpen: boolean;
  projects: ProjectViewModel[];
  roadmapItems: SearchableRoadmapItem[];
  onClose: () => void;
  onSelectProject: (project: ProjectViewModel) => void;
  onSelectRoadmapItem: (item: SearchableRoadmapItem) => void;
}

export function SearchModal({
  isOpen,
  projects,
  roadmapItems,
  onClose,
  onSelectProject,
  onSelectRoadmapItem,
}: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Flatten nested projects for search (deduplicated by ID)
  const allProjects = useMemo(() => {
    const seen = new Set<string>();
    const flatten = (items: ProjectViewModel[]): ProjectViewModel[] =>
      items.flatMap((p) => {
        const results: ProjectViewModel[] = [];
        if (!seen.has(p.id)) {
          seen.add(p.id);
          results.push(p);
        }
        results.push(...flatten(p.children));
        return results;
      });
    return flatten(projects);
  }, [projects]);

  // Build unified search results
  const projectEntries: SearchResult[] = useMemo(
    () => allProjects.map((p) => ({ type: 'project' as const, item: p })),
    [allProjects],
  );

  const roadmapEntries: SearchResult[] = useMemo(
    () => roadmapItems.map((r) => ({ type: 'roadmap' as const, item: r })),
    [roadmapItems],
  );

  const allEntries = useMemo(
    () => [...projectEntries, ...roadmapEntries],
    [projectEntries, roadmapEntries],
  );

  // Fuse.js search instance over unified entries
  const fuse = useMemo(
    () =>
      new Fuse(allEntries, {
        keys: [
          { name: 'item.title', weight: 2 },
          { name: 'item.tags', weight: 1.5 },
          { name: 'item.nextAction', weight: 1 },
          { name: 'item.id', weight: 0.5 },
          { name: 'item.projectTitle', weight: 0.5 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [allEntries],
  );

  // Search results
  const results = useMemo(() => {
    if (!query.trim()) {
      // No query: show projects first, then roadmap items, capped at 20
      return [...projectEntries.slice(0, 10), ...roadmapEntries.slice(0, 10)].slice(0, 20);
    }
    return fuse.search(query).slice(0, 20).map((r) => r.item);
  }, [query, fuse, projectEntries, roadmapEntries]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keep selected index in bounds when results change
  useEffect(() => {
    if (results.length === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const selected = resultsRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.type === 'project') {
        onSelectProject(result.item);
      } else {
        onSelectRoadmapItem(result.item);
      }
      onClose();
    },
    [onSelectProject, onSelectRoadmapItem, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, -1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, handleSelect, onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <ModalDragZone />
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <Search className="h-5 w-5 shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search projects and deliverables..."
            className="flex-1 bg-transparent text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-neutral-500">
              No results found
            </div>
          ) : (
            results.map((result, index) => (
              <div key={`${result.type}-${result.item.id}`} data-selected={index === selectedIndex}>
                <SearchResultItem
                  result={result}
                  isSelected={index === selectedIndex}
                  onClick={() => handleSelect(result)}
                />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-700">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">↑↓</kbd>
              {' '}to navigate
            </span>
            <span>
              <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">↵</kbd>
              {' '}to open
            </span>
          </div>
          <span>
            <kbd className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">esc</kbd>
            {' '}to close
          </span>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import Fuse from 'fuse.js';
import type { ProjectViewModel } from '../../lib/schema';
import { SearchResultItem } from './SearchResultItem';

interface SearchModalProps {
  isOpen: boolean;
  projects: ProjectViewModel[];
  onClose: () => void;
  onSelect: (project: ProjectViewModel) => void;
}

export function SearchModal({ isOpen, projects, onClose, onSelect }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1); // Start with nothing selected
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

  // Fuse.js search instance
  const fuse = useMemo(
    () =>
      new Fuse(allProjects, {
        keys: [
          { name: 'title', weight: 2 },
          { name: 'tags', weight: 1.5 },
          { name: 'nextAction', weight: 1 },
          { name: 'id', weight: 0.5 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [allProjects],
  );

  // Search results
  const results = useMemo(() => {
    if (!query.trim()) {
      // Show all projects sorted by status priority when no query
      return allProjects.slice(0, 15);
    }
    return fuse.search(query).slice(0, 15).map((r) => r.item);
  }, [query, fuse, allProjects]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(-1); // Start with nothing selected
      // Focus input after a brief delay for animation
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
    // Only react to results.length changes, not selectedIndex changes
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, -1)); // Allow going back to -1 (nothing selected)
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && results[selectedIndex]) {
            onSelect(results[selectedIndex]);
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, onSelect, onClose],
  );

  const handleSelect = useCallback(
    (project: ProjectViewModel) => {
      onSelect(project);
      onClose();
    },
    [onSelect, onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <Search className="h-5 w-5 shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(-1); // Reset selection when query changes
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search projects..."
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
        <div
          ref={resultsRef}
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-neutral-500">
              No projects found
            </div>
          ) : (
            results.map((project, index) => (
              <div key={project.id} data-selected={index === selectedIndex}>
                <SearchResultItem
                  project={project}
                  isSelected={index === selectedIndex}
                  onClick={() => handleSelect(project)}
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

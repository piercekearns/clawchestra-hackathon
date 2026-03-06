import { useEffect, useRef, useState } from 'react';
import { filterCommands, getCommandCount, loadCompoundCommands, type SlashCommand } from '../../lib/commands';

interface CommandDropdownProps {
  input: string;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function CommandDropdown({ input, onSelect, onClose }: CommandDropdownProps) {
  const [commandsReady, setCommandsReady] = useState(false);
  const [totalCommands, setTotalCommands] = useState(0);
  const [filtered, setFiltered] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  
  // Load compound commands on mount
  useEffect(() => {
    loadCompoundCommands().then(() => {
      setCommandsReady(true);
      setTotalCommands(getCommandCount());
    });
  }, []);

  // Update filtered list when input changes or commands load
  useEffect(() => {
    if (!commandsReady) return;
    const results = filterCommands(input);
    setFiltered(results);
    setSelectedIndex(0);
  }, [input, commandsReady]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = itemRefs.current.get(selectedIndex);
    const container = containerRef.current;
    if (!selectedElement || !container) return;

    // Get the sticky header height (if visible)
    const stickyHeader = container.querySelector('.sticky');
    const headerHeight = stickyHeader?.getBoundingClientRect().height ?? 0;
    
    const containerRect = container.getBoundingClientRect();
    const elementRect = selectedElement.getBoundingClientRect();
    
    // Effective top of visible area (below sticky header)
    const visibleTop = containerRect.top + headerHeight;
    
    // Check if element is above visible area (accounting for sticky header)
    if (elementRect.top < visibleTop) {
      // Scroll so element is at the top, below the header
      container.scrollTop = selectedElement.offsetTop - headerHeight - 4;
    }
    // Check if element is below visible area
    else if (elementRect.bottom > containerRect.bottom) {
      // Scroll so element is at the bottom
      container.scrollTop = selectedElement.offsetTop + selectedElement.offsetHeight - container.clientHeight + 4;
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filtered.length === 0) return;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(`/${filtered[selectedIndex].name} `);
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation(); // Prevent drawer from closing
          onClose();
          break;
        case 'Tab':
          // Allow Tab to close dropdown and move focus naturally
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, selectedIndex, onSelect, onClose]);
  
  // Show hint when just "/" typed, or show "no matches" if query has no results
  const query = input.slice(1);
  const showHint = query === '';
  const noMatches = query !== '' && filtered.length === 0;

  // Loading state
  if (!commandsReady) {
    return (
      <div 
        className="absolute bottom-full left-0 mb-2 w-[32rem] rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-lg z-50"
      >
        <div className="text-[11px] text-neutral-500">Loading commands...</div>
      </div>
    );
  }

  if (noMatches) return null;

  // Category badge colors
  const categoryColors: Record<string, string> = {
    workflow: 'bg-blue-900/50 text-blue-300',
    plugin: 'bg-amber-900/50 text-amber-300',
    skill: 'bg-emerald-900/50 text-emerald-300',
    session: 'bg-purple-900/50 text-purple-300',
    openclaw: 'bg-rose-900/50 text-rose-300',
  };

  return (
    <div 
      ref={containerRef}
      role="listbox"
      aria-label="Available commands"
      className="absolute bottom-full left-0 mb-2 w-[32rem] rounded-lg border border-neutral-700 bg-neutral-900 shadow-lg z-50 max-h-80 overflow-y-auto"
    >
      {showHint && (
        <div className="sticky top-0 px-3 py-1.5 text-[11px] text-neutral-500 border-b border-neutral-700/50 bg-neutral-900">
          {totalCommands} commands available — type to filter
        </div>
      )}
      <div className="p-1">
        {filtered.map((cmd, index) => (
          <button
            key={cmd.name}
            ref={(el) => {
              if (el) itemRefs.current.set(index, el);
              else itemRefs.current.delete(index);
            }}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelect(`/${cmd.name} `)}
            onMouseEnter={() => setSelectedIndex(index)}
            className={`flex w-full items-center gap-3 rounded px-3 py-1.5 text-left transition-colors ${
              index === selectedIndex
                ? 'bg-neutral-800 ring-1 ring-revival-accent/50'
                : 'hover:bg-neutral-800'
            }`}
          >
            <span className="font-medium text-revival-accent whitespace-nowrap">/{cmd.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${categoryColors[cmd.category] ?? 'bg-neutral-800 text-neutral-500'}`}>
              {cmd.category}
            </span>
            <span className="text-xs text-neutral-400 truncate flex-1">{cmd.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

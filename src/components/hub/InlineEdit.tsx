import { useEffect, useRef, useState } from 'react';
import { ScrollRevealText } from './ScrollRevealText';

interface InlineEditProps {
  value: string;
  onSave: (newValue: string) => void;
  /** When false, double-click editing is disabled (read-only display) */
  editable?: boolean;
  className?: string;
  inputClassName?: string;
  /** Use ScrollRevealText instead of plain truncation for overflow */
  useScrollReveal?: boolean;
  /** Notify parent when editing state changes */
  onEditingChange?: (editing: boolean) => void;
}

export function InlineEdit({ value, onSave, editable = true, className, inputClassName, useScrollReveal, onEditingChange }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync draft with value when not editing
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const setEditingState = (next: boolean) => {
    setEditing(next);
    onEditingChange?.(next);
  };

  const commit = () => {
    const trimmed = draft.trim();
    setEditingState(false);
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(value);
            setEditingState(false);
          }
        }}
        onBlur={commit}
        className={`w-full max-w-full bg-transparent border border-revival-accent-400/40 rounded px-1 py-0 text-sm outline-none focus:ring-1 focus:ring-revival-accent-400/40 ${inputClassName ?? ''}`}
      />
    );
  }

  if (useScrollReveal) {
    return (
      <div
        className="min-w-0"
        onDoubleClick={editable ? (e) => {
          e.stopPropagation();
          setEditingState(true);
        } : undefined}
      >
        <ScrollRevealText text={value} className={className} />
      </div>
    );
  }

  return (
    <span
      className={className}
      onDoubleClick={editable ? (e) => {
        e.stopPropagation();
        setEditingState(true);
      } : undefined}
    >
      {value}
    </span>
  );
}

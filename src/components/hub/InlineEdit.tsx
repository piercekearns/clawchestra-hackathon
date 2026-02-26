import { useEffect, useRef, useState } from 'react';
import { ScrollRevealText } from './ScrollRevealText';

interface InlineEditProps {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
  inputClassName?: string;
  /** Use ScrollRevealText instead of plain truncation for overflow */
  useScrollReveal?: boolean;
}

export function InlineEdit({ value, onSave, className, inputClassName, useScrollReveal }: InlineEditProps) {
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

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
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
            setEditing(false);
          }
        }}
        onBlur={commit}
        className={`bg-transparent border border-revival-accent-400/40 rounded px-1 py-0 text-sm outline-none focus:ring-1 focus:ring-revival-accent-400/40 ${inputClassName ?? ''}`}
      />
    );
  }

  if (useScrollReveal) {
    return (
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <ScrollRevealText text={value} className={className} />
      </div>
    );
  }

  return (
    <span
      className={className}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}

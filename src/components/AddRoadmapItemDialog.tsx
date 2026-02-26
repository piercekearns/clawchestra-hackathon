import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { ModalDragZone } from './ui/ModalDragZone';
import { ROADMAP_ITEM_STATUSES, type RoadmapItemStatus } from '../lib/constants';
import { canonicalSlugify } from '../lib/project-flows';
import { createRoadmapItem } from '../lib/tauri';
import { sendMessage, type ChatMessage } from '../lib/gateway';
import type { RoadmapItemWithDocs } from '../lib/schema';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

type CreationMode = 'ai' | 'manual';

interface AddRoadmapItemDialogProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  existingItems: RoadmapItemWithDocs[];
  gatewayConnected: boolean;
  onClose: () => void;
  onComplete: () => Promise<void> | void;
  /** Pre-select the status dropdown from the column clicked */
  initialStatus?: RoadmapItemStatus;
}

function buildContextMessage(
  projectId: string,
  projectTitle: string,
  targetStatus: string,
  existingItems: RoadmapItemWithDocs[],
): string {
  const columnItems = existingItems
    .filter((item) => item.status === targetStatus)
    .map((item) => ({ id: item.id, title: item.title, priority: item.priority }));

  const context = {
    surface: 'roadmap-item-quick-add',
    project: projectId,
    projectTitle,
    targetStatus,
    existingItemsInColumn: columnItems,
    schema: {
      requiredFields: ['id', 'title', 'status', 'priority'],
      optionalFields: ['tags', 'icon', 'nextAction'],
      statusValues: [...ROADMAP_ITEM_STATUSES],
    },
    instruction:
      'The user wants to create a new roadmap item. They will describe it in natural language. ' +
      'Structure it into a schema-compliant deliverable and create it immediately — do not ask for confirmation or show a preview. ' +
      `The item should be created in the "${targetStatus}" column of project "${projectTitle}" (id: ${projectId}).`,
  };

  return `[Roadmap Item Quick-Add Context]\n${JSON.stringify(context, null, 2)}`;
}

function getNextPriority(existingItems: RoadmapItemWithDocs[], targetStatus: string): number {
  const columnItems = existingItems.filter((item) => item.status === targetStatus);
  if (columnItems.length === 0) return 1;
  const maxPriority = Math.max(...columnItems.map((item) => item.priority ?? 0));
  return maxPriority + 1;
}

export function AddRoadmapItemDialog({
  open,
  projectId,
  projectTitle,
  existingItems,
  gatewayConnected,
  onClose,
  onComplete,
  initialStatus,
}: AddRoadmapItemDialogProps) {
  const [mode, setMode] = useState<CreationMode>('ai');
  const [error, setError] = useState<string | null>(null);

  // AI chat state
  const [aiInput, setAiInput] = useState('');
  const [aiSending, setAiSending] = useState(false);
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiStreamingContent, setAiStreamingContent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Manual fields state
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [priority, setPriority] = useState<number>(1);
  const [icon, setIcon] = useState('');

  const targetStatus = initialStatus ?? 'pending';

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (aiSending) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, aiSending]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMode('ai');
    // Reset AI state
    setAiInput('');
    setAiSending(false);
    setAiMessages([]);
    setAiStreamingContent(null);
    // Reset manual state
    setSaving(false);
    setTitle('');
    setDetails('');
    setNextAction('');
    setPriority(getNextPriority(existingItems, targetStatus));
    setIcon('');
  }, [existingItems, initialStatus, open, targetStatus]);

  // Auto-scroll chat messages
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [aiMessages, aiStreamingContent]);

  // Auto-resize AI textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // 3 lines minimum (~60px with line-height 20px), max 160px
    el.style.height = `${Math.max(60, Math.min(el.scrollHeight, 160))}px`;
  }, [aiInput]);

  if (!open) return null;

  const hasAiContent = aiInput.trim().length > 0;

  const handleAiSend = async () => {
    const text = aiInput.trim();
    if (!text || aiSending || !gatewayConnected) return;

    setError(null);
    setAiInput('');
    setAiSending(true);
    setAiStreamingContent(null);

    const userMessage: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    const updatedMessages = [...aiMessages, userMessage];
    setAiMessages(updatedMessages);

    try {
      const contextPrefix = buildContextMessage(projectId, projectTitle, targetStatus, existingItems);
      const composedContent = `${contextPrefix}\n\nUser request:\n${text}`;
      const gatewayMessages: ChatMessage[] = [
        { role: 'user', content: composedContent, timestamp: Date.now() },
      ];

      const result = await sendMessage(gatewayMessages, {
        onStreamDelta: (content) => {
          setAiStreamingContent(content);
        },
      });

      setAiStreamingContent(null);
      setAiMessages((prev) => [...prev, ...result.messages]);

      // After AI responds, refresh the board — OpenClaw should have created the item
      await onComplete();
    } catch (value) {
      setAiStreamingContent(null);
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setAiSending(false);
    }
  };

  // Manual create handler
  const itemId = canonicalSlugify(title);
  const canCreate = title.trim().length > 0 && itemId.length > 0;

  const handleManualCreate = async () => {
    setError(null);
    setSaving(true);
    try {
      await createRoadmapItem(projectId, {
        id: itemId,
        title: title.trim(),
        status: targetStatus,
        priority,
        icon: icon.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
        specDocContent: details.trim() || undefined,
      });

      await onComplete();
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  };

  const handlePriorityStep = (delta: number) => {
    setPriority((prev) => Math.max(1, prev + delta));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
      <ModalDragZone />
      <div className="flex w-full max-w-lg flex-col rounded-2xl border border-neutral-200 bg-neutral-0 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold">Add Roadmap Item</h2>
            <p className="text-xs text-neutral-500">
              {targetStatus} column
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 border-b border-neutral-200 px-5 pb-3 dark:border-neutral-700">
          <Button
            type="button"
            variant={mode === 'ai' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('ai')}
          >
            <Bot className="mr-1.5 h-3.5 w-3.5" />
            Create with OpenClaw
          </Button>
          <Button
            type="button"
            variant={mode === 'manual' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('manual')}
          >
            Create manually
          </Button>
        </div>

        {/* Body */}
        <div className="p-5">
          {mode === 'ai' ? (
            <div className="flex flex-col gap-3">
              {/* Chat input — primary affordance, immediately visible */}
              <div
                className={`relative rounded-lg border bg-neutral-0/80 transition-all focus-within:ring-1 focus-within:ring-revival-accent-400/40 dark:bg-neutral-950/70 ${
                  aiSending
                    ? 'border-revival-accent/50'
                    : 'border-neutral-300/70 dark:border-neutral-600'
                }`}
              >
                <textarea
                  ref={textareaRef}
                  value={aiInput}
                  onChange={(event) => setAiInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleAiSend();
                    }
                  }}
                  placeholder={
                    gatewayConnected
                      ? 'Describe the item and OpenClaw will create the card for you \u2014 add as much context as you need.'
                      : 'Gateway disconnected'
                  }
                  className="min-h-[60px] w-full resize-none border-0 bg-transparent px-3 py-2.5 pr-12 text-sm leading-5 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-400"
                  disabled={!gatewayConnected || aiSending}
                  autoFocus
                  rows={3}
                />

                <button
                  type="button"
                  disabled={!hasAiContent || !gatewayConnected}
                  onClick={() => void handleAiSend()}
                  aria-label={aiSending ? 'Working...' : 'Send message'}
                  className={`absolute bottom-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md p-0 leading-none transition-colors disabled:opacity-50 ${
                    aiSending
                      ? 'bg-revival-accent/70 text-[#DFFF00] hover:bg-revival-accent/90'
                      : 'bg-[#DFFF00] text-neutral-900 hover:bg-[#c8e600]'
                  }`}
                >
                  {aiSending ? <Clock className="h-4 w-4 text-[#DFFF00]" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>

              {/* Chat messages — only shown after interaction */}
              {(aiMessages.length > 0 || aiStreamingContent) && (
                <div
                  ref={scrollRef}
                  className="max-h-[280px] space-y-2 overflow-y-auto"
                >
                  {aiMessages.map((msg, i) => (
                    <div
                      key={`${msg.role}-${i}`}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'ml-6 bg-revival-accent-400 text-neutral-900'
                          : 'mr-6 bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100'
                      }`}
                    >
                      {msg.content}
                    </div>
                  ))}

                  {aiStreamingContent ? (
                    <div className="mr-6 rounded-lg bg-neutral-200 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100">
                      {aiStreamingContent}
                    </div>
                  ) : null}

                  {aiSending && !aiStreamingContent ? (
                    <div className="mr-6 flex items-center gap-2 rounded-lg bg-neutral-200 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-neutral-400" />
                      Working...
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            /* Manual fields */
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span>Title</span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Dark mode theme system"
                  autoFocus
                />
                {title.trim() && (
                  <span className="text-xs text-neutral-500">
                    Id: <code>{itemId}</code>
                  </span>
                )}
              </label>

              <label className="grid gap-1 text-sm">
                <span>Details</span>
                <Textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="Describe the deliverable, requirements, and scope..."
                  className="min-h-[100px] resize-none"
                  rows={5}
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span>Next action</span>
                <Input
                  value={nextAction}
                  onChange={(event) => setNextAction(event.target.value)}
                  placeholder="Write spec"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span>Priority</span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      value={priority}
                      onChange={(event) => setPriority(Math.max(1, Number(event.target.value) || 1))}
                      className="w-16 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => handlePriorityStep(1)}
                        className="inline-flex h-5 w-6 items-center justify-center rounded-t border border-neutral-300 bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        aria-label="Increase priority"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePriorityStep(-1)}
                        disabled={priority <= 1}
                        className="inline-flex h-5 w-6 items-center justify-center rounded-b border border-t-0 border-neutral-300 bg-neutral-100 text-neutral-600 hover:bg-neutral-200 disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        aria-label="Decrease priority"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </label>

                <label className="grid gap-1 text-sm">
                  <span>Icon (emoji)</span>
                  <Input
                    value={icon}
                    onChange={(event) => setIcon(event.target.value)}
                    placeholder=""
                    className="w-16"
                  />
                </label>
              </div>

              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={saving || !canCreate}
                  onClick={() => void handleManualCreate()}
                >
                  {saving ? 'Creating...' : 'Add Item'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="border-t border-neutral-200 px-5 py-3 dark:border-neutral-700">
            <p className="text-sm text-status-danger">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

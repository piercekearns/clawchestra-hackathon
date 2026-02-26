import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { ModalDragZone } from './ui/ModalDragZone';
import { ROADMAP_ITEM_STATUSES, type RoadmapItemStatus } from '../lib/constants';
import { canonicalSlugify } from '../lib/project-flows';
import { createRoadmapItem } from '../lib/tauri';
import { sendMessage, type ChatMessage } from '../lib/gateway';
import type { RoadmapItemWithDocs } from '../lib/schema';
import { Button } from './ui/button';
import { BrandedSelect } from './ui/branded-select';
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

const STATUS_OPTIONS: readonly RoadmapItemStatus[] = ROADMAP_ITEM_STATUSES;

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

  // Manual fields state
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<RoadmapItemStatus>(initialStatus ?? 'pending');
  const [priority, setPriority] = useState('');
  const [tags, setTags] = useState('');
  const [icon, setIcon] = useState('');
  const [nextAction, setNextAction] = useState('');

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
    setStatus(initialStatus ?? 'pending');
    setPriority('');
    setTags('');
    setIcon('');
    setNextAction('');
  }, [initialStatus, open]);

  // Auto-scroll chat messages
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [aiMessages, aiStreamingContent]);

  if (!open) return null;

  const targetStatus = initialStatus ?? 'pending';

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

      const assistantMessages = result.messages;
      setAiMessages((prev) => [...prev, ...assistantMessages]);

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
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      await createRoadmapItem(projectId, {
        id: itemId,
        title: title.trim(),
        status,
        priority: priority.trim() ? Number(priority) : undefined,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
        icon: icon.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
      });

      await onComplete();
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
      <ModalDragZone />
      <div className="flex w-full max-w-lg flex-col rounded-2xl border border-neutral-200 bg-neutral-0 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        style={{ maxHeight: 'min(600px, 80vh)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
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
        <div className="flex gap-2 border-b border-neutral-200 px-5 py-2 dark:border-neutral-700">
          <Button
            type="button"
            variant={mode === 'ai' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('ai')}
          >
            Describe to AI
          </Button>
          <Button
            type="button"
            variant={mode === 'manual' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('manual')}
          >
            Fill in manually
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === 'ai' ? (
            <div className="flex h-full flex-col gap-3">
              {/* Chat messages */}
              <div
                ref={scrollRef}
                className="min-h-[120px] flex-1 space-y-2 overflow-y-auto"
              >
                {aiMessages.length === 0 && !aiStreamingContent ? (
                  <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    Describe the roadmap item you want to create. OpenClaw will structure it and add it to the board.
                  </p>
                ) : null}

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

              {/* Chat input */}
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAiSend();
                }}
              >
                <Textarea
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
                      ? 'Describe the item you want to add...'
                      : 'Gateway disconnected'
                  }
                  className="h-16 flex-1 resize-none"
                  disabled={!gatewayConnected || aiSending}
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={!gatewayConnected || aiSending || !aiInput.trim()}
                  className="inline-flex h-16 w-12 items-center justify-center px-0"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
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

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span>Status</span>
                  <BrandedSelect
                    value={status}
                    onChange={(value) => setStatus(value as RoadmapItemStatus)}
                    options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
                  />
                </label>

                <label className="grid gap-1 text-sm">
                  <span>Priority (optional)</span>
                  <Input
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                    placeholder="Auto"
                  />
                </label>
              </div>

              <label className="grid gap-1 text-sm">
                <span>Tags (comma-separated)</span>
                <Input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="feature, ux"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span>Icon (emoji)</span>
                  <Input
                    value={icon}
                    onChange={(event) => setIcon(event.target.value)}
                    placeholder=""
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

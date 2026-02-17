import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft } from 'lucide-react';
import type { RoadmapItemWithDocs, RoadmapStatus } from '../../lib/schema';
import type { BadgeProps } from '../ui/badge';
import { StatusBadge } from './StatusBadge';
import { cn } from '../../lib/utils';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const ROADMAP_STATUSES: readonly RoadmapStatus[] = [
  'pending',
  'in-progress',
  'complete',
] as const;

const ROADMAP_STATUS_LABELS: Partial<Record<RoadmapStatus, string>> = {
  'pending': 'Pending',
  'in-progress': 'In Progress',
  'complete': 'Complete',
};

function roadmapStatusVariant(status: RoadmapStatus): BadgeVariant {
  switch (status) {
    case 'pending':
    case 'up-next':
      return 'outline';
    case 'in-progress':
      return 'accent';
    case 'complete':
      return 'success';
  }
}

type DocTab = 'spec' | 'plan';

interface RoadmapItemDetailProps {
  item: RoadmapItemWithDocs;
  projectTitle: string;
  initialTab?: DocTab;
  onBack: () => void;
  onStatusChange: (itemId: string, status: RoadmapStatus) => void;
  fetchDocContent: (path: string) => Promise<string>;
  getDocContent: (path: string) => string | undefined;
  docLoading: boolean;
}

export function RoadmapItemDetail({
  item,
  projectTitle,
  initialTab,
  onBack,
  onStatusChange,
  fetchDocContent,
  getDocContent,
  docLoading,
}: RoadmapItemDetailProps) {
  const availableTabs: DocTab[] = [];
  if (item.docs.spec) availableTabs.push('spec');
  if (item.docs.plan) availableTabs.push('plan');

  const [activeTab, setActiveTab] = useState<DocTab | null>(
    initialTab && availableTabs.includes(initialTab) ? initialTab : availableTabs[0] ?? null,
  );

  // Fetch doc content when tab changes
  useEffect(() => {
    if (!activeTab) return;
    const path = activeTab === 'spec' ? item.docs.spec : item.docs.plan;
    if (!path) return;

    const cached = getDocContent(path);
    if (cached !== undefined) return;

    void fetchDocContent(path);
  }, [activeTab, item.docs.spec, item.docs.plan, fetchDocContent, getDocContent]);

  const activeDocPath = activeTab === 'spec' ? item.docs.spec : item.docs.plan;
  const activeDocContent = activeDocPath ? getDocContent(activeDocPath) : undefined;

  return (
    <div>
      <button
        type="button"
        className="mb-3 flex items-center gap-1 rounded text-sm text-neutral-500 transition-colors hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-revival-accent-400 dark:hover:text-neutral-200"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {projectTitle}
      </button>

      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {item.title}
        </h3>
        <StatusBadge<RoadmapStatus>
          value={item.status}
          options={ROADMAP_STATUSES}
          labels={ROADMAP_STATUS_LABELS}
          variant={roadmapStatusVariant}
          onChange={(next) => onStatusChange(item.id, next)}
        />
      </div>

      {item.nextAction && (
        <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
          <span className="font-medium">Next:</span> {item.nextAction}
        </p>
      )}

      {availableTabs.length > 0 && (
        <div>
          <div className="mb-3 flex gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-700">
            {availableTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={cn(
                  'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-revival-accent-400',
                  activeTab === tab
                    ? 'border-revival-accent-400 text-neutral-900 dark:text-neutral-100'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'spec' ? 'Spec' : 'Plan'}
              </button>
            ))}
          </div>

          <div className="prose max-w-none rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:prose-invert">
            {docLoading && activeDocContent === undefined ? (
              <div className="flex flex-col gap-2">
                {[95, 80, 88, 72].map((w, i) => (
                  <div
                    key={i}
                    className="h-4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"
                    style={{ width: `${w}%` }}
                  />
                ))}
              </div>
            ) : activeDocContent !== undefined ? (
              <ReactMarkdown>{activeDocContent}</ReactMarkdown>
            ) : (
              <p className="text-neutral-500">Could not load document</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

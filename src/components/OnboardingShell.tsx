import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FolderPlus, LifeBuoy, PlugZap, Rocket, TerminalSquare } from 'lucide-react';
import { SettingsForm } from './SettingsForm';
import { Button } from './ui/button';
import type { DashboardSettings } from '../lib/settings';
import type { ProjectViewModel } from '../lib/schema';
import { detectAgents, getTerminalDependencyStatus, type DetectedAgent, type TerminalDependencyStatus } from '../lib/tauri';
import { AGENT_LABELS } from '../lib/terminal-utils';

interface OnboardingShellProps {
  mode: 'first-run' | 'rerun';
  settings: DashboardSettings | null;
  existingProjects: ProjectViewModel[];
  settingsDirty: boolean;
  onSettingsDirtyChange: (dirty: boolean) => void;
  onSaveSettings: (settings: DashboardSettings) => Promise<void>;
  onOpenProjectWizard: () => void;
  onComplete: () => Promise<void>;
  onClose?: () => void;
  onNotify?: (kind: 'success' | 'error', message: string) => void;
}

type OnboardingStepId = 'welcome' | 'connection' | 'projects' | 'terminals' | 'ready';

type StepDefinition = {
  id: OnboardingStepId;
  title: string;
  subtitle: string;
  icon: typeof Rocket;
};

const STEPS: StepDefinition[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    subtitle: 'What Clawchestra needs and what it will not do',
    icon: Rocket,
  },
  {
    id: 'connection',
    title: 'Connect OpenClaw',
    subtitle: 'Save chat, sync, scan-path, and support settings',
    icon: PlugZap,
  },
  {
    id: 'projects',
    title: 'Add a project',
    subtitle: 'Reuse the existing project wizard for create or import',
    icon: FolderPlus,
  },
  {
    id: 'terminals',
    title: 'Terminal readiness',
    subtitle: 'Check tmux/persistence behavior on this machine',
    icon: TerminalSquare,
  },
  {
    id: 'ready',
    title: 'Ready',
    subtitle: 'Finish onboarding and land in the board',
    icon: CheckCircle2,
  },
];

function StepRail({ currentStep }: { currentStep: OnboardingStepId }) {
  const currentIndex = STEPS.findIndex((step) => step.id === currentStep);

  return (
    <div className="grid gap-2">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const active = step.id === currentStep;
        const complete = index < currentIndex;
        return (
          <div
            key={step.id}
            className={`rounded-2xl border px-4 py-3 ${
              active
                ? 'border-revival-accent-400 bg-revival-accent-400/10'
                : complete
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-neutral-200 bg-neutral-0 dark:border-neutral-800 dark:bg-neutral-950/40'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 rounded-full p-2 ${active ? 'bg-revival-accent-400 text-neutral-950' : complete ? 'bg-emerald-500 text-white' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300'}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{step.title}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">{step.subtitle}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OnboardingShell({
  mode,
  settings,
  existingProjects,
  settingsDirty,
  onSettingsDirtyChange,
  onSaveSettings,
  onOpenProjectWizard,
  onComplete,
  onClose,
  onNotify,
}: OnboardingShellProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStepId>('welcome');
  const [projectStepAcknowledged, setProjectStepAcknowledged] = useState(false);
  const [connectionSavedAt, setConnectionSavedAt] = useState<number | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<TerminalDependencyStatus | null>(null);
  const [terminalStatusLoading, setTerminalStatusLoading] = useState(true);
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgent[]>([]);
  const [completing, setCompleting] = useState(false);

  const currentIndex = STEPS.findIndex((step) => step.id === currentStep);
  const hasProjects = existingProjects.length > 0;
  const canLeaveProjectStep = hasProjects || projectStepAcknowledged;
  const canAdvance =
    currentStep === 'projects'
      ? canLeaveProjectStep
      : currentStep === 'connection'
        ? Boolean(settings) && !settingsDirty
        : true;

  useEffect(() => {
    if (!hasProjects) return;
    setProjectStepAcknowledged(true);
  }, [hasProjects]);

  useEffect(() => {
    let cancelled = false;
    setTerminalStatusLoading(true);
    void Promise.all([
      getTerminalDependencyStatus().catch(() => null),
      detectAgents().catch(() => [] as DetectedAgent[]),
    ])
      .then(([status, agents]) => {
        if (!cancelled) {
          setTerminalStatus(status);
          setDetectedAgents(agents);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTerminalStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const readySummary = useMemo(
    () => [
      {
        label: 'Onboarding mode',
        value: mode === 'first-run' ? 'First launch' : 'Re-run',
      },
      {
        label: 'Chat transport',
        value: settings?.openclawChatTransportMode ?? 'Unknown',
      },
      {
        label: 'Sync transport',
        value: settings?.openclawSyncMode ?? 'Unknown',
      },
      {
        label: 'Scan paths',
        value: settings?.scanPaths.length ? settings.scanPaths.join(', ') : 'None configured yet',
      },
      {
        label: 'Projects',
        value: hasProjects ? `${existingProjects.length} tracked` : 'No projects tracked yet',
      },
      {
        label: 'Terminal mode',
        value: terminalStatus?.tmuxAvailable
          ? 'Persistent tmux-backed terminals available'
          : terminalStatus?.platform === 'windows'
            ? 'Persistent Windows terminal host available'
            : 'Clawchestra will offer tmux remediation when you create a terminal',
      },
    ],
    [existingProjects.length, hasProjects, mode, settings, terminalStatus],
  );
  const codingAgents = useMemo(
    () => detectedAgents.filter((agent) => agent.agentType !== 'tmux'),
    [detectedAgents],
  );
  const availableCodingAgents = useMemo(
    () => codingAgents.filter((agent) => agent.available),
    [codingAgents],
  );
  const missingCodingAgents = useMemo(
    () => codingAgents.filter((agent) => !agent.available),
    [codingAgents],
  );

  const nextStep = () => {
    if (!canAdvance) return;
    const next = STEPS[currentIndex + 1];
    if (next) setCurrentStep(next.id);
  };

  const previousStep = () => {
    const previous = STEPS[currentIndex - 1];
    if (previous) setCurrentStep(previous.id);
  };

  const shellTitle = mode === 'first-run' ? 'Get Clawchestra ready' : 'Run onboarding again';
  const shellSubtitle =
    mode === 'first-run'
      ? 'This guides a new install through connection, project setup, and terminal readiness.'
      : 'Use the same first-run flow to recheck OpenClaw, projects, and terminal setup.';

  return (
    <div className="min-h-full w-full px-8 py-6">
      <div className="mx-auto flex w-full max-w-7xl gap-6 xl:gap-8">
        <aside className="hidden w-80 shrink-0 xl:block">
          <div className="sticky top-0 grid gap-4">
            <div className="rounded-3xl border border-neutral-200 bg-neutral-0 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/70">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">First friend readiness</div>
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{shellTitle}</h1>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{shellSubtitle}</p>
            </div>
            <StepRail currentStep={currentStep} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="rounded-3xl border border-neutral-200 bg-neutral-0 p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/70">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">
                  Step {currentIndex + 1} of {STEPS.length}
                </div>
                <h2 className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{STEPS[currentIndex]?.title}</h2>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{STEPS[currentIndex]?.subtitle}</p>
              </div>
              {mode === 'rerun' && onClose ? (
                <Button type="button" variant="outline" onClick={onClose}>
                  Close
                </Button>
              ) : null}
            </div>

            {currentStep === 'welcome' ? (
              <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">What Clawchestra needs</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
                      <li>Where to scan for projects.</li>
                      <li>How to reach OpenClaw for chat and sync.</li>
                      <li>Whether local OpenClaw support files need installing or refreshing.</li>
                      <li>Whether this machine can provide persistent embedded terminals.</li>
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Access transparency</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
                      <li>Chat transport uses either your local OpenClaw runtime or the remote websocket URL you provide.</li>
                      <li>Sync transport is configured separately and can stay disabled if you do not want sync yet.</li>
                      <li>Clawchestra only installs the OpenClaw extension locally when you tell it to.</li>
                      <li>Terminal remediation is handled inside the app when terminals need tmux on macOS or Linux.</li>
                    </ul>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-950 p-5 text-neutral-100 dark:border-neutral-700">
                  <div className="flex items-center gap-2 text-sm font-medium text-revival-accent-400">
                    <LifeBuoy className="h-4 w-4" />
                    Outcome of this flow
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-neutral-300">
                    <p>You should end with a saved transport setup, at least one known project path, and a clear understanding of how terminals and OpenClaw support behave on this machine.</p>
                    <p>If you are re-running onboarding, nothing here deletes project state. It only updates settings and lets you re-enter the existing project wizard.</p>
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 'connection' ? (
              <div className="grid gap-4">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-300">
                  Save any changes you make here before continuing. This is the same settings surface you can revisit later, including transport tests and local OpenClaw support actions.
                </div>
                <SettingsForm
                  active
                  settings={settings}
                  onSave={onSaveSettings}
                  onSaved={() => setConnectionSavedAt(Date.now())}
                  onDirtyChange={onSettingsDirtyChange}
                  onNotify={onNotify}
                />
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  {settingsDirty
                    ? 'Save changes to continue to the next onboarding step.'
                    : connectionSavedAt
                      ? `Settings saved during onboarding at ${new Date(connectionSavedAt).toLocaleTimeString()}.`
                      : 'No unsaved settings changes right now.'}
                </div>
              </div>
            ) : null}

            {currentStep === 'projects' ? (
              <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Use the existing project wizard</h3>
                    <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                      This step reuses the same Create New / Add Existing flow the app already uses, including scan-path checks, state preservation, migration, and guidance injection.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" onClick={onOpenProjectWizard}>
                        <FolderPlus className="mr-2 h-4 w-4" />
                        Open project wizard
                      </Button>
                      {!hasProjects ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setProjectStepAcknowledged(true)}
                        >
                          I will add a project later
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Current board state</h3>
                  {hasProjects ? (
                    <div className="mt-3 grid gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                      <p>{existingProjects.length} project{existingProjects.length === 1 ? '' : 's'} currently tracked.</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {existingProjects.slice(0, 6).map((project) => (
                          <li key={project.id}>{project.title}</li>
                        ))}
                      </ul>
                      {existingProjects.length > 6 ? <p>And {existingProjects.length - 6} more.</p> : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
                      No projects are tracked yet. You can still finish onboarding, but the board will stay empty until you add or import one.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {currentStep === 'terminals' ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Terminal readiness on this machine</h3>
                  {terminalStatusLoading ? (
                    <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">Checking terminal dependencies...</p>
                  ) : terminalStatus ? (
                    <div className="mt-3 grid gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                      <p>Platform: {terminalStatus.platform}</p>
                      <p>
                        tmux: {terminalStatus.tmuxAvailable ? `available (${terminalStatus.tmuxPath ?? 'detected'})` : 'not detected'}
                      </p>
                      <p>{terminalStatus.installerNote}</p>
                      {terminalStatus.installerCommand ? (
                        <div className="rounded-xl border border-neutral-200 bg-neutral-0 px-3 py-2 font-mono text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200">
                          {terminalStatus.installerCommand}
                        </div>
                      ) : null}
                      <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-0 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">Available coding agents</div>
                        {availableCodingAgents.length > 0 ? (
                          <div className="mt-2 text-sm">
                            {availableCodingAgents.map((agent) => AGENT_LABELS[agent.agentType as keyof typeof AGENT_LABELS] ?? agent.command).join(', ')}
                          </div>
                        ) : (
                          <div className="mt-2 text-sm">No dedicated coding agent CLI detected yet. Shell terminals still work.</div>
                        )}
                        {missingCodingAgents.length > 0 ? (
                          <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                            Not detected:
                            {' '}
                            {missingCodingAgents.map((agent) => AGENT_LABELS[agent.agentType as keyof typeof AGENT_LABELS] ?? agent.command).join(', ')}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">Terminal readiness could not be determined from the desktop bridge.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">What happens later</h3>
                    <div className="mt-3 grid gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                      <p>On macOS and Linux, missing tmux no longer hard-blocks the feature. Clawchestra offers an in-app remediation path when you create a terminal.</p>
                    <p>On Windows, terminal sessions now use a local background host so they can survive drawer close and Clawchestra relaunch.</p>
                    <p>This step is informational. You do not need to install tmux here to finish onboarding.</p>
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 'ready' ? (
              <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Ready to leave onboarding</h3>
                  <div className="mt-3 grid gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                    <p>Finishing onboarding marks this install as setup-complete. You can re-run the flow later from Settings.</p>
                    {!hasProjects ? (
                      <p>The board will stay empty until you add or import a project.</p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/70">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Summary</h3>
                  <dl className="mt-3 grid gap-2 text-sm">
                    {readySummary.map((entry) => (
                      <div key={entry.label} className="grid gap-1 rounded-xl border border-neutral-200 bg-neutral-0 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950">
                        <dt className="text-xs uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">{entry.label}</dt>
                        <dd className="text-neutral-700 dark:text-neutral-200">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ) : null}

            <div className="mt-8 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {currentStep === 'projects' && !canLeaveProjectStep
                  ? 'Add a project or explicitly defer it before continuing.'
                  : null}
              </div>
              <div className="flex items-center gap-2">
                {currentIndex > 0 ? (
                  <Button type="button" variant="outline" onClick={previousStep}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                ) : null}

                {currentStep === 'ready' ? (
                  <Button
                    type="button"
                    disabled={completing}
                    onClick={async () => {
                      setCompleting(true);
                      try {
                        await onComplete();
                      } finally {
                        setCompleting(false);
                      }
                    }}
                  >
                    {completing ? 'Finishing...' : 'Finish onboarding'}
                  </Button>
                ) : (
                  <Button type="button" disabled={!canAdvance} onClick={nextStep}>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

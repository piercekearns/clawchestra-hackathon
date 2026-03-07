import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, FolderPlus, Loader2, RefreshCw, Wifi } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { ProjectViewModel } from '../lib/schema';
import type { OpenClawChatTransportMode, DashboardSettings } from '../lib/settings';
import {
  getOpenClawSupportStatus,
  resolveOpenClawGatewayConfigPreview,
  setOpenclawChatToken,
} from '../lib/tauri';
import { checkGatewayConnection } from '../lib/gateway';

interface OnboardingShellProps {
  mode: 'first-run' | 'rerun';
  settings: DashboardSettings | null;
  existingProjects: ProjectViewModel[];
  onOpenProjectWizard: () => void;
  onSaveSettings: (patch: Partial<DashboardSettings>) => Promise<void>;
  onComplete: () => Promise<void>;
  onClose?: () => void;
}

type StepId = 'welcome' | 'connect' | 'project' | 'ready';

const STEPS: StepId[] = ['welcome', 'connect', 'project', 'ready'];

type ConnectionStatus =
  | 'detecting'
  | 'connected'
  | 'not-running'
  | 'not-installed'
  | 'remote-needed'
  | 'remote-testing'
  | 'remote-success'
  | 'remote-failed'
  | 'error';

/** Revival-accent success card — matches chat bubbles and sync success cards */
const SUCCESS_CARD = 'rounded-2xl border border-revival-accent-400/40 bg-revival-accent-100 dark:bg-revival-accent-900/30 px-5 py-3';

export function OnboardingShell({
  mode,
  settings,
  existingProjects,
  onOpenProjectWizard,
  onSaveSettings,
  onComplete,
  onClose,
}: OnboardingShellProps) {
  const [currentStep, setCurrentStep] = useState<StepId>('welcome');
  const [completing, setCompleting] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);

  // OpenClaw connection state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('detecting');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const hasTriedDetect = useRef(false);

  const currentIndex = STEPS.indexOf(currentStep);
  const hasProjects = existingProjects.length > 0;

  // Animate welcome in
  useEffect(() => {
    const timer = setTimeout(() => setWelcomeVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Auto-detect OpenClaw when entering the connect step
  const detectOpenClaw = useCallback(async () => {
    setConnectionStatus('detecting');
    setConnectionMessage('Looking for OpenClaw on this machine...');

    try {
      const status = await getOpenClawSupportStatus();

      if (!status.openclawRootExists) {
        setConnectionStatus('not-installed');
        setConnectionMessage('');
        return;
      }

      // OpenClaw directory exists — try to connect
      setConnectionMessage('Found OpenClaw. Testing connection...');

      const connected = await checkGatewayConnection();
      if (connected) {
        setConnectionStatus('connected');
        setConnectionMessage('Connected to OpenClaw on this machine.');
        await onSaveSettings({
          openclawChatTransportMode: 'Local' as OpenClawChatTransportMode,
        });
      } else {
        setConnectionStatus('not-running');
        setConnectionMessage('');
      }
    } catch {
      setConnectionStatus('error');
      setConnectionMessage('Something went wrong while checking for OpenClaw.');
    }
  }, [onSaveSettings]);

  useEffect(() => {
    if (currentStep === 'connect' && !hasTriedDetect.current) {
      hasTriedDetect.current = true;
      void detectOpenClaw();
    }
  }, [currentStep, detectOpenClaw]);

  const testRemoteConnection = useCallback(async () => {
    const url = remoteUrl.trim();
    if (!url) return;

    setConnectionStatus('remote-testing');
    setConnectionMessage('Testing connection...');

    try {
      const tokenValue = remoteToken.trim() || null;
      if (tokenValue) {
        await setOpenclawChatToken(tokenValue);
      }

      const preview = await resolveOpenClawGatewayConfigPreview({
        mode: 'Remote',
        wsUrl: url,
        sessionKey: null,
        token: tokenValue,
      });

      const connected = await checkGatewayConnection({
        transport: {
          mode: 'tauri-ws',
          wsUrl: preview.wsUrl,
          token: preview.token,
          sessionKey: preview.sessionKey,
        },
      });

      if (connected) {
        setConnectionStatus('remote-success');
        setConnectionMessage('Connected to your remote OpenClaw server.');
        await onSaveSettings({
          openclawChatTransportMode: 'Remote' as OpenClawChatTransportMode,
          openclawChatWsUrl: url,
        });
      } else {
        setConnectionStatus('remote-failed');
        setConnectionMessage(
          'Could not connect. Check that OpenClaw is running and the URL is correct.',
        );
      }
    } catch (err) {
      setConnectionStatus('remote-failed');
      setConnectionMessage(
        err instanceof Error ? err.message : 'Connection test failed.',
      );
    }
  }, [remoteUrl, remoteToken, onSaveSettings]);

  const goNext = useCallback(() => {
    const next = STEPS[currentIndex + 1];
    if (next) setCurrentStep(next);
  }, [currentIndex]);

  const goToStep = useCallback((index: number) => {
    // Only allow going to completed steps (back navigation)
    if (index < currentIndex) {
      setCurrentStep(STEPS[index]);
    }
  }, [currentIndex]);

  const handleFinish = useCallback(async () => {
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  }, [onComplete]);

  const canAdvanceConnect =
    connectionStatus === 'connected' ||
    connectionStatus === 'remote-success';

  return (
    <div className="flex h-full flex-col">
      {/* Progress bar below title bar */}
      <div className="flex gap-1.5 px-6 pt-4">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                i <= currentIndex
                  ? 'w-full bg-revival-accent-400/40'
                  : 'w-0'
              }`}
            />
          </div>
        ))}
      </div>

      {/* Skip button for rerun mode */}
      {mode === 'rerun' && onClose && (
        <div className="flex justify-end px-6 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
          >
            Skip
          </button>
        </div>
      )}

      {/* Step content */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        {currentStep === 'welcome' && (
          <div
            className={`flex max-w-lg flex-col items-center text-center transition-all duration-700 ease-out ${
              welcomeVisible
                ? 'translate-y-0 opacity-100'
                : 'translate-y-4 opacity-0'
            }`}
          >
            <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              Welcome to Clawchestra
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
              Your projects, your AI tools, one place.
              {mode === 'first-run'
                ? " Let's get you set up in under a minute."
                : ' Run through setup again to check your connection or add projects.'}
            </p>
            <Button
              type="button"
              className="mt-10 h-12 px-8 text-base"
              onClick={goNext}
            >
              Get started
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        )}

        {currentStep === 'connect' && (
          <div className="flex max-w-lg flex-col items-center text-center">
            <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-revival-accent-400/10">
              <Wifi className="h-10 w-10 text-revival-accent-400" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              Connect to OpenClaw
            </h1>
            <p className="mt-3 text-base leading-relaxed text-neutral-500 dark:text-neutral-400">
              Clawchestra uses OpenClaw as its AI backend. Let's make sure they can talk to each other.
            </p>

            <div className="mt-8 w-full max-w-md">
              {/* Detecting */}
              {connectionStatus === 'detecting' && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-6 py-5 dark:border-neutral-800 dark:bg-neutral-900/50">
                  <Loader2 className="h-6 w-6 animate-spin text-revival-accent-400" />
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">{connectionMessage}</p>
                </div>
              )}

              {/* Connected (local) */}
              {connectionStatus === 'connected' && (
                <div className={`flex flex-col items-center gap-3 ${SUCCESS_CARD}`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-revival-accent-400/20">
                    <Check className="h-5 w-5 text-revival-accent-400" />
                  </div>
                  <p className="text-sm text-neutral-900 dark:text-neutral-100">{connectionMessage}</p>
                </div>
              )}

              {/* Remote success */}
              {connectionStatus === 'remote-success' && (
                <div className={`flex flex-col items-center gap-3 ${SUCCESS_CARD}`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-revival-accent-400/20">
                    <Check className="h-5 w-5 text-revival-accent-400" />
                  </div>
                  <p className="text-sm text-neutral-900 dark:text-neutral-100">{connectionMessage}</p>
                </div>
              )}

              {/* Not installed */}
              {connectionStatus === 'not-installed' && (
                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-6 py-5 text-left dark:border-neutral-800 dark:bg-neutral-900/50">
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                      OpenClaw wasn't found on this machine. Where is your OpenClaw running?
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 justify-start px-5 text-left text-sm"
                      onClick={() => setConnectionStatus('remote-needed')}
                    >
                      <Wifi className="mr-3 h-4 w-4 shrink-0 text-revival-accent-400" />
                      It's on a remote server
                    </Button>
                    <a
                      href="https://github.com/nichochar/open-claw"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-12 items-center rounded-md border border-neutral-300 bg-transparent px-5 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      <ArrowRight className="mr-3 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
                      I need to set up OpenClaw first
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={goNext}
                    className="mt-1 text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-400"
                  >
                    Skip for now
                  </button>
                </div>
              )}

              {/* Not running (installed but can't connect) */}
              {connectionStatus === 'not-running' && (
                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-6 py-5">
                    <div className="flex items-start gap-3">
                      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                      <div className="text-left text-sm text-amber-700 dark:text-amber-300/90">
                        <p>OpenClaw is installed but doesn't seem to be running.</p>
                        <p className="mt-2 text-neutral-500 dark:text-neutral-400">
                          Start OpenClaw, then tap retry. Or connect to a remote server instead.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Button
                      type="button"
                      className="h-11"
                      onClick={() => {
                        hasTriedDetect.current = false;
                        void detectOpenClaw();
                      }}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Retry
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={() => setConnectionStatus('remote-needed')}
                    >
                      Connect to a remote server instead
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={goNext}
                    className="mt-1 text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-400"
                  >
                    Skip for now
                  </button>
                </div>
              )}

              {/* Remote config form */}
              {(connectionStatus === 'remote-needed' ||
                connectionStatus === 'remote-testing' ||
                connectionStatus === 'remote-failed') && (
                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-6 py-5 text-left dark:border-neutral-800 dark:bg-neutral-900/50">
                    <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
                      Enter your OpenClaw server details.
                    </p>
                    <div className="grid gap-3">
                      <label className="grid gap-1.5 text-sm">
                        <span className="text-neutral-500 dark:text-neutral-400">Server URL</span>
                        <Input
                          value={remoteUrl}
                          onChange={(e) => setRemoteUrl(e.target.value)}
                          placeholder="ws://192.168.1.100:18789"
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm">
                        <span className="text-neutral-500 dark:text-neutral-400">
                          Token{' '}
                          <span className="text-neutral-400 dark:text-neutral-600">(if required)</span>
                        </span>
                        <Input
                          type="password"
                          value={remoteToken}
                          onChange={(e) => setRemoteToken(e.target.value)}
                          placeholder="Leave blank if none"
                        />
                      </label>
                    </div>
                  </div>

                  {connectionStatus === 'remote-failed' && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-left text-sm text-red-600 dark:text-red-400">
                      {connectionMessage}
                    </div>
                  )}

                  <Button
                    type="button"
                    className="h-11"
                    disabled={
                      !remoteUrl.trim() ||
                      connectionStatus === 'remote-testing'
                    }
                    onClick={() => void testRemoteConnection()}
                  >
                    {connectionStatus === 'remote-testing' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      'Test connection'
                    )}
                  </Button>

                  <button
                    type="button"
                    onClick={() => setConnectionStatus('not-installed')}
                    className="text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-400"
                  >
                    Back
                  </button>
                </div>
              )}

              {/* Error state */}
              {connectionStatus === 'error' && (
                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-5">
                    <p className="text-sm text-red-600 dark:text-red-400">{connectionMessage}</p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      hasTriedDetect.current = false;
                      void detectOpenClaw();
                    }}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try again
                  </Button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-400"
                  >
                    Skip for now
                  </button>
                </div>
              )}
            </div>

            {/* Continue button (only when connected) */}
            {canAdvanceConnect && (
              <Button
                type="button"
                className="mt-8 h-12 px-8 text-base"
                onClick={goNext}
              >
                Continue
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            )}
          </div>
        )}

        {currentStep === 'project' && (
          <div className="flex max-w-lg flex-col items-center text-center">
            <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-revival-accent-400/10">
              <FolderPlus className="h-10 w-10 text-revival-accent-400" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              {hasProjects ? 'Projects added' : 'Add your first project'}
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
              {hasProjects
                ? 'Looking good. You can always add more from inside the app.'
                : 'Point Clawchestra at an existing project folder and it will set up your board automatically.'}
            </p>

            {hasProjects && (
              <div className={`mt-6 ${SUCCESS_CARD}`}>
                <p className="text-sm text-neutral-900 dark:text-neutral-100">
                  {existingProjects.length} project{existingProjects.length === 1 ? '' : 's'} tracked
                </p>
              </div>
            )}

            <div className="mt-8 flex flex-col items-center gap-3">
              {hasProjects ? (
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-6"
                    onClick={onOpenProjectWizard}
                  >
                    <FolderPlus className="mr-2 h-4 w-4" />
                    Add another project
                  </Button>
                  <Button
                    type="button"
                    className="h-11 px-6"
                    onClick={goNext}
                  >
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    className="h-12 px-8 text-base"
                    onClick={onOpenProjectWizard}
                  >
                    <FolderPlus className="mr-2 h-5 w-5" />
                    Add a project
                  </Button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="text-sm text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
                  >
                    Skip — you can add or create projects from the sidebar any time
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {currentStep === 'ready' && (
          <div className="flex max-w-lg flex-col items-center text-center">
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              You're all set
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
              {hasProjects
                ? "Your board is ready. You can always add more projects or tweak settings later."
                : "You can add projects any time from the sidebar. Settings are in there too."}
            </p>
            <Button
              type="button"
              className="mt-10 h-12 px-8 text-base"
              disabled={completing}
              onClick={handleFinish}
            >
              {completing ? 'Opening Clawchestra...' : 'Open Clawchestra'}
              {!completing && <ArrowRight className="ml-2 h-5 w-5" />}
            </Button>
          </div>
        )}
      </div>

      {/* Step indicator dots — clickable for back navigation */}
      <div className="flex justify-center gap-2 pb-8 pt-4">
        {STEPS.map((step, i) => (
          <button
            key={step}
            type="button"
            onClick={() => goToStep(i)}
            disabled={i >= currentIndex}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === currentIndex
                ? 'w-6 bg-revival-accent-400'
                : i < currentIndex
                  ? 'w-2 cursor-pointer bg-revival-accent-400/40 hover:bg-revival-accent-400/70'
                  : 'w-2 cursor-default bg-neutral-300 dark:bg-neutral-700'
            }`}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

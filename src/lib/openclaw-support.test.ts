import { describe, expect, it } from 'bun:test';
import { buildRemoteOpenclawInstallScript, buildRemoteSystemContextContent } from './openclaw-support';

describe('openclaw support helpers', () => {
  it('builds a remote install script with settings, extension, and system context', () => {
    const script = buildRemoteOpenclawInstallScript({
      bearerToken: 'secret-token',
      extensionContent: 'export default function () {}',
    });

    expect(script).toContain('settings.json');
    expect(script).toContain('clawchestra-data-endpoint.ts');
    expect(script).toContain('system-context.md');
    expect(script).toContain('secret-token');
    expect(script).toContain('Restart OpenClaw if it is already running');
  });

  it('generates a generic remote system context body', () => {
    const content = buildRemoteSystemContextContent();

    expect(content).toContain('You are integrated with Clawchestra');
    expect(content).toContain('~/.openclaw/clawchestra/db.json');
    expect(content).toContain('This system context was installed for a remote OpenClaw host');
  });
});

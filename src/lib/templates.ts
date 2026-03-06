import { readFile, resolvePath, writeFile } from './tauri';

function fillTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((result, [key, value]) => {
    return result.split(`{{${key}}}`).join(value);
  }, template);
}

async function readTemplate(relativePath: string): Promise<string> {
  const root = await resolvePath('.');
  return readFile(`${root}/${relativePath}`);
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  try {
    await readFile(path);
  } catch {
    await writeFile(path, content);
  }
}

export async function bootstrapProjectTemplates(localPath: string, projectTitle: string): Promise<void> {
  const resolvedRepoPath = await resolvePath(localPath);
  const today = new Date().toISOString().split('T')[0];

  const replacements = {
    PROJECT_TITLE: projectTitle,
    TODAY: today,
  };

  const clawchestraTemplate = fillTemplate(
    await readTemplate('docs/templates/CLAWCHESTRA.md'),
    replacements,
  );
  const agentsTemplate = fillTemplate(
    await readTemplate('docs/templates/AGENTS.md'),
    replacements,
  );

  await writeIfMissing(`${resolvedRepoPath}/CLAWCHESTRA.md`, clawchestraTemplate);
  await writeIfMissing(`${resolvedRepoPath}/AGENTS.md`, agentsTemplate);
}

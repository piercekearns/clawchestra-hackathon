import type { ProjectViewModel } from './schema';

export function buildHierarchy(projects: ProjectViewModel[]): ProjectViewModel[] {
  const lookup = new Map<string, ProjectViewModel & { children: ProjectViewModel[] }>();

  for (const project of projects) {
    lookup.set(project.id, { ...project, children: [] });
  }

  const roots: ProjectViewModel[] = [];

  for (const project of lookup.values()) {
    if (project.frontmatter.parent) {
      const parent = lookup.get(project.frontmatter.parent);
      if (parent) {
        parent.children.push(project);
      } else {
        console.warn(`Parent "${project.frontmatter.parent}" not found for "${project.id}"`);
        roots.push(project);
      }
    } else {
      roots.push(project);
    }
  }

  for (const project of lookup.values()) {
    if (project.children.length) {
      project.children.sort((a, b) => (a.frontmatter.priority ?? 99) - (b.frontmatter.priority ?? 99));
    }
  }

  roots.sort((a, b) => (a.frontmatter.priority ?? 99) - (b.frontmatter.priority ?? 99));

  return roots;
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architectural boundaries as executable rules. Runtime dependencies point
 * inward: interfaces -> runtime -> adapters -> application -> domain.
 */
const ROOT = path.resolve(import.meta.dirname, '..');

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  '@atx/domain': [],
  '@atx/config': [],
  '@atx/ui': [],
  '@atx/search': ['@atx/domain'],
  '@atx/application': ['@atx/domain', '@atx/search'],
  '@atx/contracts': ['@atx/domain'],
  '@atx/observability': ['@atx/application'],
  '@atx/auth': ['@atx/application', '@atx/domain'],
  '@atx/ai': ['@atx/application', '@atx/domain', '@atx/search'],
  '@atx/infrastructure': ['@atx/application', '@atx/domain', '@atx/search'],
  '@atx/runtime': ['*packages'],
  '@atx/test-utils': ['*packages'],
  '@atx/api': ['*packages'],
  '@atx/mcp-server': ['*packages'],
  '@atx/worker': ['*packages'],
  '@atx/web': ['@atx/contracts', '@atx/ui', '@atx/config'],
};

interface Workspace {
  readonly name: string;
  readonly dir: string;
  readonly kind: 'packages' | 'apps';
  readonly dependencies: string[];
}

const workspaces: Workspace[] = ['packages', 'apps'].flatMap((kind) =>
  readdirSync(path.join(ROOT, kind))
    .filter((dir) => statSync(path.join(ROOT, kind, dir, 'package.json'), { throwIfNoEntry: false }))
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(path.join(ROOT, kind, dir, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string> };
      return {
        name: pkg.name,
        dir: path.join(ROOT, kind, dir),
        kind: kind as Workspace['kind'],
        dependencies: Object.keys(pkg.dependencies ?? {}).filter((dep) => dep.startsWith('@atx/')),
      };
    }),
);
const packageNames = new Set(workspaces.filter((w) => w.kind === 'packages').map((w) => w.name));

const allowed = (from: string, to: string): boolean => {
  const rules = ALLOWED[from];
  if (!rules) return false;
  return rules.includes(to) || (rules.includes('*packages') && packageNames.has(to) && to !== '@atx/test-utils');
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') return [];
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });

describe('architecture', () => {
  it('every workspace has an explicit dependency rule', () => {
    for (const workspace of workspaces) expect(ALLOWED[workspace.name], workspace.name).toBeDefined();
  });

  it.each(workspaces.map((w) => [w.name, w] as const))('%s only depends on allowed workspaces', (_name, workspace) => {
    const violations = workspace.dependencies.filter((dep) => !allowed(workspace.name, dep));
    expect(violations).toEqual([]);
  });

  it.each(workspaces.map((w) => [w.name, w] as const))('%s source imports only declared @atx dependencies', (_name, workspace) => {
    const srcDir = path.join(workspace.dir, workspace.name === '@atx/web' ? '' : 'src');
    const imports = new Set<string>();
    for (const file of sourceFiles(srcDir)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from\s+'(@atx\/[a-z-]+)/g)) imports.add(match[1] as string);
    }
    const undeclared = [...imports].filter((name) => name !== workspace.name && !workspace.dependencies.includes(name));
    expect(undeclared).toEqual([]);
  });

  it('packages never depend on apps', () => {
    const appNames = new Set(workspaces.filter((w) => w.kind === 'apps').map((w) => w.name));
    for (const workspace of workspaces.filter((w) => w.kind === 'packages')) {
      expect(workspace.dependencies.filter((dep) => appNames.has(dep)), workspace.name).toEqual([]);
    }
  });

  it('the workspace dependency graph is acyclic', () => {
    const byName = new Map(workspaces.map((w) => [w.name, w]));
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (name: string, trail: string[]): void => {
      if (state.get(name) === 'done') return;
      if (state.get(name) === 'visiting') throw new Error(`cycle: ${[...trail, name].join(' -> ')}`);
      state.set(name, 'visiting');
      for (const dep of byName.get(name)?.dependencies ?? []) visit(dep, [...trail, name]);
      state.set(name, 'done');
    };
    for (const workspace of workspaces) visit(workspace.name, []);
  });
});

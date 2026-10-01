import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { type McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * MCP Skills extension (SEP-2640, `io.modelcontextprotocol/skills`): exposes
 * the Automotive Technology Exchange skill(s) via `skills/list`, `skills/get`
 * and `skill://<name>/<file>` resources. Skill files are loaded once at
 * startup from the repository's `skills/` directory.
 */
export const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills';
const CACHE = { ttlMs: 3_600_000, cacheScope: 'public' } as const;

interface SkillFile {
  readonly uri: string;
  readonly content: string;
  readonly digest: string;
  readonly size: number;
  readonly mimeType: string;
}

export interface LoadedSkill {
  readonly name: string;
  readonly uri: string;
  readonly frontmatter: Record<string, unknown>;
  readonly files: readonly SkillFile[];
}

const listFiles = (directory: string, prefix = ''): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? listFiles(full, `${prefix}${entry}/`) : [`${prefix}${entry}`];
  });

export const loadSkills = (root: string): LoadedSkill[] =>
  readdirSync(root)
    .filter((entry) => statSync(path.join(root, entry)).isDirectory())
    .sort()
    .map((name) => {
      const directory = path.join(root, name);
      const skillMd = readFileSync(path.join(directory, 'SKILL.md'), 'utf8');
      const match = /^---\n([\s\S]*?)\n---\n/.exec(skillMd);
      const frontmatter = (match?.[1] ? parse(match[1]) : {}) as Record<string, unknown>;
      if (frontmatter['name'] !== name || typeof frontmatter['description'] !== 'string') {
        throw new Error(`Skill ${name}: frontmatter must contain name "${name}" and a description`);
      }
      const files = listFiles(directory)
        .sort()
        .map((file) => {
          const content = readFileSync(path.join(directory, file), 'utf8');
          return {
            uri: `skill://${name}/${file}`,
            content,
            digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
            size: Buffer.byteLength(content),
            mimeType: file.endsWith('.md') ? 'text/markdown' : 'text/plain',
          };
        });
      return { name, uri: `skill://${name}/SKILL.md`, frontmatter, files };
    });

const skillEntry = (skill: LoadedSkill) => ({
  uri: skill.uri,
  frontmatter: skill.frontmatter,
  resources: skill.files.map((file) => ({ uri: file.uri, digest: file.digest, size: file.size })),
});

export const registerSkills = (server: McpServer, skills: readonly LoadedSkill[]): void => {
  for (const skill of skills) {
    for (const file of skill.files) {
      server.registerResource(`${skill.name}/${file.uri.split('/').slice(3).join('/')}`, file.uri, { mimeType: file.mimeType, description: `Skill file of ${skill.name}` }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: file.mimeType, text: file.content }],
      }));
    }
  }
  server.server.setRequestHandler('skills/list', { params: z.object({ cursor: z.string().optional() }).loose() }, async () => ({
    resultType: 'complete',
    skills: skills.map(skillEntry),
    ...CACHE,
  }));
  server.server.setRequestHandler('skills/get', { params: z.object({ uri: z.string() }).loose() }, async (params) => {
    const skill = skills.find((candidate) => candidate.uri === params.uri);
    if (!skill) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown skill: ${params.uri}`);
    return { resultType: 'complete', skill: skillEntry(skill), ...CACHE };
  });
};

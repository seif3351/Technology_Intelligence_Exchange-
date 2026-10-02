import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CONSTRAINT_LEVELS,
  type Concept,
  type ConceptRelation,
  type ConstraintLevel,
  type Facet,
  ORDINAL_QUALIFIERS,
  type OntologySnapshot,
  RELATION_TYPES,
  asId,
  isOrdinalQualifierKey,
  isSlug,
} from '@atx/domain';
import { parse } from 'yaml';

/**
 * Reads the ontology from data/ontology/*.yaml. Validation errors name the
 * file and concept so that data editors get actionable feedback.
 */
interface RawFacet {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  default_level?: unknown;
}

type RawConcept = Record<string, unknown>;

const asString = (value: unknown, where: string): string => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${where}: expected non-empty string`);
  return value.trim();
};

const asStringList = (value: unknown, where: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${where}: expected a list`);
  return value.map((item, index) => asString(String(item), `${where}[${index}]`));
};

const parseLevel = (value: unknown, where: string): ConstraintLevel => {
  const level = asString(value, `${where}.default_level`);
  if (!(CONSTRAINT_LEVELS as readonly string[]).includes(level))
    throw new Error(`${where}: default_level must be one of ${CONSTRAINT_LEVELS.join(', ')}`);
  return level as ConstraintLevel;
};

const parseQualifierKeys = (value: unknown, where: string): string[] => {
  const keys = asStringList(value, `${where}.qualifiers`);
  for (const key of keys) {
    if (!isOrdinalQualifierKey(key))
      throw new Error(
        `${where}: unknown qualifier "${key}" (known: ${ORDINAL_QUALIFIERS.map((q) => q.key).join(', ')})`,
      );
  }
  return keys;
};

export const parseOntologyDocuments = (
  facetsYaml: string,
  conceptFiles: readonly { readonly name: string; readonly content: string }[],
): OntologySnapshot => {
  const rawFacets = parse(facetsYaml) as RawFacet[];
  const facets: Facet[] = rawFacets.map((raw, index) => {
    const where = `facets.yaml[${index}]`;
    const level = asString(raw.default_level ?? 'supports', `${where}.default_level`);
    if (!(CONSTRAINT_LEVELS as readonly string[]).includes(level)) {
      throw new Error(`${where}: default_level must be one of ${CONSTRAINT_LEVELS.join(', ')}`);
    }
    return {
      id: asId(asString(raw.id, `${where}.id`)),
      label: asString(raw.label, `${where}.label`),
      description: asString(raw.description, `${where}.description`),
      defaultConstraintLevel: level as ConstraintLevel,
    };
  });

  const concepts: Concept[] = [];
  const relations: ConceptRelation[] = [];
  const seen = new Set<string>();
  for (const file of conceptFiles) {
    const entries = (parse(file.content) ?? []) as RawConcept[];
    entries.forEach((raw, index) => {
      const id = asString(raw['id'], `${file.name}[${index}].id`);
      const where = `${file.name}:${id}`;
      if (!isSlug(id)) throw new Error(`${where}: id must be lowercase kebab-case`);
      if (seen.has(id)) throw new Error(`${where}: duplicate concept id`);
      seen.add(id);
      const status = raw['status'] === 'deprecated' ? 'deprecated' : 'active';
      concepts.push({
        id: asId(id),
        facetId: asId(asString(raw['facet'], `${where}.facet`)),
        label: asString(raw['label'], `${where}.label`),
        description: asString(raw['description'], `${where}.description`),
        aliases: asStringList(raw['aliases'], `${where}.aliases`),
        caseSensitiveAliases: asStringList(raw['case_sensitive_aliases'], `${where}.case_sensitive_aliases`),
        ...(raw['default_level'] === undefined
          ? {}
          : { defaultConstraintLevel: parseLevel(raw['default_level'], where) }),
        ...(raw['qualifiers'] === undefined
          ? {}
          : { qualifierKeys: parseQualifierKeys(raw['qualifiers'], where) }),
        status,
      });
      for (const type of RELATION_TYPES) {
        for (const target of asStringList(raw[type], `${where}.${type}`)) {
          relations.push({ fromConceptId: asId(id), toConceptId: asId(target), type });
        }
      }
    });
  }
  return { facets, concepts, relations };
};

export const loadOntologyFromDirectory = async (directory: string): Promise<OntologySnapshot> => {
  const facetsYaml = await readFile(path.join(directory, 'facets.yaml'), 'utf8');
  const conceptDir = path.join(directory, 'concepts');
  const names = (await readdir(conceptDir)).filter((name) => name.endsWith('.yaml')).sort();
  const conceptFiles = await Promise.all(
    names.map(async (name) => ({ name, content: await readFile(path.join(conceptDir, name), 'utf8') })),
  );
  return parseOntologyDocuments(facetsYaml, conceptFiles);
};

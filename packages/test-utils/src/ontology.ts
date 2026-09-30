import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ontology } from '@atx/domain';
import { loadOntologyFromDirectory } from '@atx/infrastructure';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ONTOLOGY_DIR = path.join(REPO_ROOT, 'data/ontology');

let cached: Promise<Ontology> | undefined;

/** The real ontology data, loaded once per test process. */
export const loadTestOntology = (): Promise<Ontology> => {
  cached ??= loadOntologyFromDirectory(ONTOLOGY_DIR).then((snapshot) => new Ontology(snapshot));
  return cached;
};

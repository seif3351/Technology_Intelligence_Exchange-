export * from './content/scanner';
export * from './content/text-extractor';
export * from './ontology/yaml-source';
export * from './postgres/db';
export * from './postgres/jobs';
export * from './postgres/migrate';
export * from './postgres/ontology-provider';
export * from './postgres/repositories/index';
export * from './postgres/search-index';
export * from './storage/object-storage';

export const systemClock = { now: (): Date => new Date() };

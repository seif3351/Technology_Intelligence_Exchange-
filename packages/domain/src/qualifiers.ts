/**
 * Ordinal qualifiers: standardized integrity and capability scales that turn
 * "ISO 26262 experience" into "ISO 26262 experience at ASIL B or higher".
 *
 * The scales are defined by the standards themselves (ISO 26262 ASIL,
 * Automotive SPICE capability levels, ISO/SAE 21434 CAL), so they live in the
 * domain. Which concepts a buyer can qualify with which scale is ontology data
 * (`Concept.qualifierKeys`); no code branches on concept ids.
 */
export interface OrdinalQualifier {
  readonly key: string;
  /** Short name used in sentences, e.g. "ASIL". */
  readonly label: string;
  /** Ordered from weakest to strongest. */
  readonly scale: readonly string[];
  /** "B" -> "ASIL B", "2" -> "CL2". */
  readonly format: (value: string) => string;
}

export const ASIL_LEVELS = ['QM', 'A', 'B', 'C', 'D'] as const;

export const ORDINAL_QUALIFIERS: readonly OrdinalQualifier[] = [
  {
    key: 'asil',
    label: 'ASIL',
    scale: ASIL_LEVELS,
    format: (value) => (value === 'QM' ? 'QM' : `ASIL ${value}`),
  },
  {
    key: 'aspiceLevel',
    label: 'Automotive SPICE capability level',
    scale: ['1', '2', '3', '4', '5'],
    format: (value) => `CL${value}`,
  },
  {
    key: 'cal',
    label: 'Cybersecurity assurance level',
    scale: ['1', '2', '3', '4'],
    format: (value) => `CAL ${value}`,
  },
];

const BY_KEY = new Map(ORDINAL_QUALIFIERS.map((qualifier) => [qualifier.key, qualifier]));

export const ordinalQualifier = (key: string): OrdinalQualifier | undefined => BY_KEY.get(key);

export const isOrdinalQualifierKey = (key: string): boolean => BY_KEY.has(key);

/** Returns a problem message when `value` is not on the scale of an ordinal `key`. */
export const ordinalValueProblem = (key: string, value: string): string | null => {
  const qualifier = BY_KEY.get(key);
  if (!qualifier || qualifier.scale.includes(value)) return null;
  return `${key} must be one of ${qualifier.scale.join(', ')}`;
};

/**
 * Compares a claimed value with a required minimum on the same scale:
 * 'yes' when it reaches the minimum, 'no' when it is lower, 'unknown' when the
 * claim does not state the qualifier (never assume the stronger reading).
 */
export const meetsOrdinal = (
  key: string,
  claimed: string | undefined,
  required: string,
): 'yes' | 'no' | 'unknown' => {
  const qualifier = BY_KEY.get(key);
  if (!qualifier) return claimed === required ? 'yes' : claimed === undefined ? 'unknown' : 'no';
  if (claimed === undefined) return 'unknown';
  const have = qualifier.scale.indexOf(claimed);
  const need = qualifier.scale.indexOf(required);
  if (have < 0 || need < 0) return 'no';
  return have >= need ? 'yes' : 'no';
};

/** Required ordinal qualifiers of a constraint, e.g. { asil: 'B' }, in registry order. */
export const ordinalRequirements = (
  qualifiers: Readonly<Record<string, string>>,
): readonly { readonly qualifier: OrdinalQualifier; readonly value: string }[] =>
  ORDINAL_QUALIFIERS.flatMap((qualifier) => {
    const value = qualifiers[qualifier.key];
    return value === undefined ? [] : [{ qualifier, value }];
  });

/**
 * Human phrasing of claim qualifiers, e.g. { asil: 'B', certificationBody: 'X' }
 * -> ['ASIL B', 'certified by X']. Unknown keys are shown as "key: value" so
 * nothing a supplier stated is hidden.
 */
export const formatQualifiers = (qualifiers: Readonly<Record<string, string>>): string[] => {
  const parts: string[] = [];
  for (const { qualifier, value } of ordinalRequirements(qualifiers)) parts.push(qualifier.format(value));
  for (const [key, value] of Object.entries(qualifiers)) {
    if (BY_KEY.has(key)) continue;
    if (key === 'certificationBody') parts.push(`certified by ${value}`);
    else if (key === 'release' || key === 'version') parts.push(`release ${value}`);
    else parts.push(`${humanizeKey(key)}: ${value}`);
  }
  return parts;
};

const humanizeKey = (key: string): string =>
  key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();

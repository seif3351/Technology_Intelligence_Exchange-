/** API errors as the BFF sees them, and their plain-language wording for users. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly { path?: string; message: string }[] = [],
  ) {
    super(message);
  }
}

/** Plain-language versions of the schema validator's messages. */
const FRIENDLY: readonly [RegExp, (match: RegExpExecArray) => string][] = [
  [/expected string to have >=\s*(\d+) characters?/i, (m) => `at least ${m[1]} characters`],
  [/expected string to have <=\s*(\d+) characters?/i, (m) => `at most ${m[1]} characters`],
  [/expected array to have >=\s*(\d+) items?/i, (m) => `choose at least ${m[1]}`],
  [/expected array to have <=\s*(\d+) items?/i, (m) => `at most ${m[1]} entries`],
  [/invalid uuid/i, () => 'refers to something that no longer exists'],
  [/invalid email/i, () => 'is not a valid email address'],
  [/invalid url/i, () => 'is not a valid https:// address'],
  [/received undefined/i, () => 'is required'],
  [/invalid option/i, () => 'has a value that is not allowed'],
];

const friendly = (message: string): string => {
  for (const [pattern, phrase] of FRIENDLY) {
    const match = pattern.exec(message);
    if (match) return phrase(match);
  }
  return message;
};

/** "body.contactEmail" -> "contact email"; list positions are dropped. */
const fieldName = (path: string | undefined): string =>
  (path ?? '')
    .split('.')
    .slice(1)
    .filter((part) => !/^\d+$/.test(part))
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();

export const describeError = (error: unknown): string => {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  // Request-schema problems ("Invalid body") are rephrased per field; domain errors are already plain language.
  if (/^Invalid (body|query|params)$/.test(error.message) && error.details.length > 0) {
    const problems = error.details.map((d) => {
      const field = fieldName(d.path);
      return field ? `${field}: ${friendly(d.message)}` : friendly(d.message);
    });
    return `Please check your input — ${[...new Set(problems)].join('; ')}.`;
  }
  return `${error.message}${error.details.length ? ` (${error.details.map((d) => friendly(d.message)).join('; ')})` : ''}`;
};

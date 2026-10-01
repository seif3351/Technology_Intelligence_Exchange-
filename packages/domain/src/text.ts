/**
 * Text helpers used for untrusted content. Supplier-authored text is data,
 * never instructions: we strip control characters and bound its length before
 * it reaches any downstream consumer (UI, agent, LLM).
 */
const char = (code: number): string => String.fromCharCode(code);
const range = (from: number, to: number): string => `${char(from)}-${char(to)}`;
/** C0 controls (except tab/newline/CR), DEL, zero-width and bidirectional override characters. */
const CONTROL_CHARS = new RegExp(
  `[${range(0x00, 0x08)}${char(0x0b)}${char(0x0c)}${range(0x0e, 0x1f)}${char(0x7f)}${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`,
  'g',
);

export const sanitizeUntrustedText = (value: string, maxLength = 5000): string => {
  const cleaned = value.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
};

/**
 * Lower-cases, strips diacritics and punctuation while keeping characters that
 * carry meaning inside technical tokens ("SOME/IP", "ara::com", "C++").
 * Punctuation at token edges ("QNX.", "(Orin)") is removed.
 */
export const normalizeForMatching = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./:]+/g, ' ')
    .split(' ')
    .map((token) => token.replace(/^[./:]+|[./:]+$/g, ''))
    .filter((token) => token.length > 0)
    .join(' ');

const INJECTION_SIGNALS: readonly RegExp[] = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /you are now/i,
  /\bsystem prompt\b/i,
  /<\/?(system|assistant|tool)[^>]*>/i,
  /call (the )?tool/i,
  /(send|forward|email|post) .{0,40}(requirement|confidential|credentials|token)/i,
  /rank (this|us|our) (supplier|offering|product) (first|highest|#?1)/i,
];

/**
 * Heuristic detection of prompt-injection style content. This does NOT make
 * content safe (nothing can); it flags content for moderation and lets agents
 * see that a field looked suspicious. Safety comes from treating all supplier
 * content as data everywhere.
 */
export const detectInjectionSignals = (value: string): string[] =>
  INJECTION_SIGNALS.filter((pattern) => pattern.test(value)).map((pattern) => pattern.source);

import type { ExtractionResult, TextExtractor } from '@atx/application';
import { extractText, getDocumentProxy } from 'unpdf';

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/** Converts HTML to plain text without executing or rendering anything. */
export const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

/** Drops WebVTT headers, cue timings and cue identifiers, keeping spoken text. */
export const vttToText = (vtt: string): string =>
  vtt
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() !== '' &&
        !/^WEBVTT/.test(line) &&
        !/-->/.test(line) &&
        !/^\d+$/.test(line.trim()) &&
        !/^NOTE\b/.test(line),
    )
    .map((line) => line.replace(/<[^>]+>/g, ''))
    .join('\n');

/**
 * Text extraction for documents and transcripts. Video transcription is a
 * separate, pluggable concern: suppliers can upload a WebVTT transcript as a
 * `transcript` asset; speech-to-text providers can be added behind this port.
 */
export const defaultTextExtractor: TextExtractor = {
  async extract(bytes, contentType): Promise<ExtractionResult> {
    switch (contentType) {
      case 'text/plain':
      case 'text/markdown':
        return { kind: 'text', text: decode(bytes) };
      case 'text/html':
        return { kind: 'text', text: htmlToText(decode(bytes)) };
      case 'text/vtt':
        return { kind: 'text', text: vttToText(decode(bytes)) };
      case 'application/pdf': {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text } = await extractText(pdf, { mergePages: true });
        return { kind: 'text', text };
      }
      default:
        return { kind: 'unsupported', reason: `no text extractor for ${contentType}` };
    }
  },
};

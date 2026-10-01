import { connect } from 'node:net';
import type { MalwareScanner, ScanResult } from '@atx/application';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** Verifies that the bytes really are the declared media type (prevents polyglot/mislabelled uploads). */
export const contentMatchesType = (bytes: Uint8Array, contentType: string): boolean => {
  switch (contentType) {
    case 'application/pdf':
      return ascii(bytes, 0, 5) === '%PDF-';
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
    case 'video/mp4':
      return ascii(bytes, 4, 4) === 'ftyp';
    case 'video/webm':
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'text/plain':
    case 'text/markdown':
    case 'text/html':
    case 'text/vtt':
      return isUtf8Text(bytes);
    default:
      return false;
  }
};

const isUtf8Text = (bytes: Uint8Array): boolean => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/**
 * Built-in scanning boundary: media-type verification plus EICAR test
 * signature detection. This is NOT antivirus; production deployments chain it
 * with ClamAV (see createClamdScanner) or a managed scanning service.
 */
export const basicContentScanner: MalwareScanner = {
  async scan(bytes, declaredContentType): Promise<ScanResult> {
    if (!contentMatchesType(bytes, declaredContentType)) {
      return { clean: false, reason: 'content does not match declared media type' };
    }
    const sample = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)));
    if (sample.includes(EICAR))
      return { clean: false, reason: 'malware signature detected (EICAR test file)' };
    return { clean: true };
  },
};

/** ClamAV clamd INSTREAM scanner (TCP). */
export const createClamdScanner = (host: string, port: number, timeoutMs = 30_000): MalwareScanner => ({
  scan: (bytes) =>
    new Promise<ScanResult>((resolve, reject) => {
      const socket = connect({ host, port });
      let response = '';
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd timeout')));
      socket.on('error', reject);
      socket.on('data', (chunk) => (response += chunk.toString('utf8')));
      socket.on('end', () => {
        if (/OK\0?$/.test(response.trim())) resolve({ clean: true });
        else if (/FOUND/.test(response))
          resolve({ clean: false, reason: `malware detected: ${response.replace(/\0/g, '').trim()}` });
        else reject(new Error(`unexpected clamd response: ${response.slice(0, 200)}`));
      });
      socket.write('zINSTREAM\0');
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    }),
});

/** Runs scanners in order; the first non-clean verdict wins. */
export const chainScanners = (...scanners: readonly MalwareScanner[]): MalwareScanner => ({
  async scan(bytes, contentType) {
    for (const scanner of scanners) {
      const result = await scanner.scan(bytes, contentType);
      if (!result.clean) return result;
    }
    return { clean: true };
  },
});

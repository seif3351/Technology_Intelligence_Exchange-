# ADR-0008: Asynchronous asset processing

## Decision

- Asset metadata in PostgreSQL; bytes behind the `ObjectStorage` port (filesystem for dev, S3/S3-compatible adapter for production; keys validated against traversal).
- Pipeline (worker, `asset.process` job): `uploaded → scanning → quarantined | processing → ready | failed`. The scan boundary verifies magic bytes vs declared type, detects EICAR, and chains ClamAV (`CLAMAV_HOST`) when configured. Text extraction for PDF (unpdf), text, Markdown, HTML (tag-stripped), WebVTT transcripts. Claim drafting via the AI port.
- Externally hosted videos are registered by URL (https, public hosts only) and never fetched server-side (no SSRF surface).
- Jobs: PostgreSQL table with `FOR UPDATE SKIP LOCKED`, dedupe keys, exponential backoff, dead-lettering and stale-lock recovery. Downloads only via short-lived HMAC-signed URLs with `Content-Disposition: attachment` and `nosniff`.

## Consequences

No Redis/Kafka needed; the job abstraction can move to SQS/Cloud Tasks later. Large (multi-GB) video uploads should move to presigned direct-to-storage uploads (next step); speech-to-text is a pluggable future extractor.

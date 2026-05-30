# @gentleduck/upload - Threat Model

Aligned to **OWASP ASVS 4.0** + **STRIDE** taxonomy. Treat as the starting point for a third-party review, not a substitute.

## 1. Assets

| Asset | What | Disclosure impact | Tamper impact |
|---|---|---|---|
| **File content** | Raw bytes uploaded | Privacy / regulatory exposure | Content forgery / replacement |
| **Filename + metadata** | `file.name`, `file.type`, `file.lastModified` | Low (UI-rendered text) | Filename smuggling, MIME confusion |
| **Presigned URL** (POST, PUT, multipart) | URL + form fields signed by backend | Anyone with the URL writes to the object key | Same |
| **Upload intent** | `{ strategy, fileId, url, ... }` from backend | Reveals storage layout | Diverts upload to attacker-controlled URL |
| **Cursor** (multipart) | Per-part ETags + completion state | Reveals upload progress shape | Skip already-uploaded parts; reuse-attack with tampered ETags |
| **Persisted snapshot** | `localStorage` / IndexedDB row | Reveals queue + intents | Replays old upload sessions; injects malicious cursor |
| **Checksum** (sha256 of file) | Computed client-side | Reveals content presence | Bypasses dedupe |

## 2. Attackers

| Attacker | Capability |
|---|---|
| **Compromised backend** | Returns adversarial intent URLs (private hosts, `file://`, attacker-controlled host) |
| **MITM** | Modifies network responses to insert adversarial URLs |
| **Same-origin XSS** | Writes arbitrary JSON into `localStorage` / IndexedDB; tampers persisted snapshots |
| **Malicious uploader (the file)** | Tries to bypass MIME / extension / size limits, smuggle filenames, OS reserved-name collisions |
| **Other-tab attacker** | Concurrent same-origin tab races for the storage key |

Out of scope:
- OS / browser exploit; physical access; TLS interception at the edge; DNS rebinding (client-side check only blocks IP literals).

## 3. Trust boundaries

```
       +------------+
       |  User picks|
       |   file     |
       +-----+------+
             |  [BOUNDARY 1: filename + MIME from File API]
       +-----v------+
       | Engine     | <-- sanitizeFilename, magic-byte sniff, size cap
       +-----+------+
             |  [BOUNDARY 2: intent fetched from backend]
       +-----v------+
       | Strategy   | <-- validateUploadUrl (SSRF guard)
       +-----+------+
             |  [BOUNDARY 3: XHR to presigned URL]
       +-----v------+
       | Object     |
       | storage    |
       +------------+

       [BOUNDARY 4: persisted snapshot deserialized]
                  ^-- stripDangerousKeys + isFiniteNumber + isRecord
```

## 4. Security-critical paths

| Path | What it owns | If broken |
|---|---|---|
| `core/utils/url-safety.ts` `validateUploadUrl` | SSRF allowlist + protocol + private-host guard | Backend can divert upload to attacker URL or scan internal network |
| `core/utils/sanitize-filename.ts` `sanitizeFilename` | NFKC + control-char strip + Windows reserved-names + path-sep + 255-char cap | Hostile filenames smuggle CR/LF / reach shell tools |
| `core/utils/mime-sniff.ts` `sniffMime` + `validateMimeSignature` | Magic-byte vs claimed `file.type` | Polyglot files served as wrong MIME by storage layer |
| `core/utils/id.ts` `generateId` | CSPRNG-only ID generation | Predictable IDs collide and leak ordering |
| `core/engine/validation/file.ts` `validateFile` | Size / type / extension allowlists | Oversize / wrong-type files reach storage |
| `core/engine/validation/intent.ts` `validateIntent` | Intent shape + URL validity + partSize finite-positive | Tampered intent crashes downstream or routes to attacker URL |
| `core/persistence/persistence.ts` `deserializeSnapshot` | NaN / Infinity / negative defense + structural narrowing | Hostile localStorage payload corrupts engine state |
| `core/persistence/adapters.local.ts` + `adapters.indexeddb.ts` | `stripDangerousKeys` on read | Prototype pollution via persisted JSON |
| `core/errors.ts` `UploadEngineError` | Static error messages; tainted values on `.context` | Filename rendered as HTML via `error.message` |

## 5. Defense-in-depth catalog

- **SSRF guard**: every backend-returned URL routes through `validateUploadUrl`. Multipart + POST strategies both call it. Allowlist + protocol + private-host / cloud-metadata / NAT64 / 6to4 / IPv4-mapped IPv6 / loopback / RFC1918 / CGNAT / multicast / broadcast.
- **CSPRNG-only IDs**: `crypto.randomUUID` → `crypto.getRandomValues` → throw. No `Math.random` fallback.
- **Magic-byte MIME sniff**: cross-checks claimed `file.type` against 16-byte head; `strict` mode rejects, default mode warns once per pair.
- **Filename sanitization pipeline (SEC-005)**: 8 steps; reserved-name + 255-char cap + path-sep + control-char + leading dash + trailing dot/space + NFKC + empty-result rejection.
- **Static error messages (SEC-003)**: filename never interpolated into `Error.message`. Tainted values live on `error.context`.
- **Prototype-pollution defense (SEC-002)**: every persisted snapshot passes through `stripDangerousKeys` before any spread / property copy.
- **NaN-bypass defense**: persistence deserializer + intent validator + checksum cap all use `Number.isFinite` + non-negative checks on numeric fields.
- **Single-flight per upload**: `inflightUploads` map prevents double-start.
- **Cursor + completion tracking**: multipart sessions skip already-completed parts on resume; `completed: true` prevents double-finalize.
- **Persistence skips terminal items**: `completed` / `canceled` / `error` items are never written; restore only resumes in-flight uploads.
- **Length cap on checksum input**: files over `checksumMaxSize` skip the digest entirely instead of streaming a huge ArrayBuffer.
- **Console-warn-once latches**: missing `allowedHosts` warning fires once per process; MIME-mismatch warning fires once per claimed-vs-sniffed pair. No log flooding.

## 6. Known gaps + unfinished work

- **DNS rebinding** is out of scope. A hostname that resolves to a public IP at validation time but a private IP at fetch time will bypass the IP-literal check.
- **No third-party security audit**. The library has had multiple internal security passes (SEC-001 through SEC-018; visible in `git log`) but no outside review.
- **Persistence is per-origin**: cross-tab races can race on the storage key. The store's effect queue does serialize writes within one tab; cross-tab is not synchronized.
- **`file.type` is trusted for the validation decision** when `strictMimeMatch: false`. Caller MUST set `strictMimeMatch: true` for content-type-sensitive storage backends.
- **No content scanning**. The engine does not inspect file contents for malware. Storage layer / antivirus is the operator's responsibility.
- **Checksum is sha256 over `arrayBuffer()`**: still loads the whole file. Streaming digest was attempted (commit `0869ccc4b`) then reverted to skip-on-large in `22c71af7c` for memory safety.

## 7. Cryptographic primitives

| Use | Primitive | Source |
|---|---|---|
| Upload ID | UUIDv4 | `crypto.randomUUID` / `crypto.getRandomValues` |
| File checksum | SHA-256 | `crypto.subtle.digest` |
| MIME signature | magic-byte prefix match | bytes-as-numbers; no crypto |

No bespoke crypto. No `Math.random()` in security paths.

## 8. Reporting

See `SECURITY.md` for disclosure policy (security@gentleduck.com, 90-day window). CVE-eligible issues should be reported privately, not in public GitHub issues.

# Security Policy

## Supported Versions
We provide security updates for the latest major release of duck-upload.
Older versions may not receive patches.

## Reporting a Vulnerability
**Please do not disclose security issues publicly.**
If you discover a vulnerability in duck-upload:

1. Report it privately by emailing: **security@gentleduck.com**
2. Include a detailed description of the vulnerability and how to reproduce it.
3. We will confirm receipt within **48 hours** and provide a timeline for a fix.

## Responsible Disclosure
We ask security researchers to give us **90 days** to address issues before public disclosure.
We will credit you in release notes unless you prefer to remain anonymous.

Thank you for helping keep duck-upload secure.

## Threat model + audit

For the full STRIDE-mapped threat model see [`packages/duck-upload/THREAT-MODEL.md`](packages/duck-upload/THREAT-MODEL.md) - every defense the library ships and every assumption it makes about the operator is enumerated there.

For the dependency audit see [`packages/duck-upload/AUDIT-RESULTS.md`](packages/duck-upload/AUDIT-RESULTS.md) - re-runnable via `bun audit`; current run is clean (0 advisories).

# Security Policy

Deployhaven provisions, hardens, and deploys to real servers, so we take
security seriously. Thank you for helping keep Deployhaven and its users safe.

## Reporting a vulnerability

Please report security vulnerabilities privately. Do not open a public GitHub
issue, discussion, or pull request for a security problem, since that discloses
the issue before a fix is available.

Preferred: report privately through GitHub Security Advisories using the
"Report a vulnerability" button under the repository's
[Security tab](https://github.com/denizbarish/deployhaven/security/advisories/new).
This keeps the report private and lets us collaborate on a fix and coordinated
disclosure.

Alternative: email `security@deployhaven` (TODO: maintainer to replace this
placeholder with a real, monitored address before publishing).

When reporting, please include as much detail as you can:

- A clear description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- Affected component (api, panel, db, provisioning, hardening, etc.) and version
  or commit.
- Any suggested remediation, if you have one.

## What to expect

- We aim to acknowledge a valid report within a few business days.
- We will investigate, keep you updated on progress, and coordinate a disclosure
  timeline with you.
- We will credit reporters who wish to be credited once a fix is released.

Please give us a reasonable amount of time to address the issue before any
public disclosure.

## Supported versions

Deployhaven is pre-1.0 and under active development. Security fixes are applied
to the latest `0.x` release line only.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Scope

In scope: the Deployhaven control plane (api), panel, database layer, and the
provisioning, hardening, and deploy logic in this repository.

Out of scope: vulnerabilities in third-party dependencies (report those to the
respective upstream project, though feel free to let us know so we can update),
and issues that require physical access or a compromised maintainer machine.

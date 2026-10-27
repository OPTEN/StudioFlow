# Security policy

StudioFlow runs a live production: the Regie account, the pairing of devices, the media connection and the output link
protect real broadcasts. We take reports about weaknesses seriously and thank everyone who reports one responsibly.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a vulnerability.** Report it privately through GitHub
Security Advisories:

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability** (direct link:
   <https://github.com/OPTEN/StudioFlow/security/advisories/new>).
3. Fill in the form. Only the maintainers can read the report.

If the form is not available to you, open a public issue that says only "I need a private channel for a security
report" (no details) and a maintainer will get in touch.

### What to include

- The affected version (the Regie shows it in the settings menu, the output page in the `?debug=1` overlay, the API in
  `GET /api/system/info`) or the commit.
- What is affected and what an attacker can do: take over the Regie, see or switch another production, listen to or see
  a device, read a link or a key, reach the server or other containers.
- The steps to reproduce, as short as possible: requests, a script or a proof of concept. Please use your own
  installation and synthetic data.
- How you are set up: operating system, TLS mode, whether a reverse proxy is in front.
- Whether you plan to publish, and by when. We ask for 90 days from your report to prepare a fix.

Please do not test against installations that are not yours, do not read or change data of others, and do not run
denial-of-service or social-engineering attacks. Reports that follow this policy are not pursued legally.

## What you can expect

| Step | Target |
|---|---|
| Reply that the report arrived | within 5 working days |
| Assessment (confirmed, needs more information, not a vulnerability) | within 10 working days |
| Fix and release for a confirmed high or critical issue | within 30 days; others with the next regular release |
| Public advisory with credit (if you want it) | when the fix is released |

We publish a GitHub Security Advisory with the fix, with a CVE where it applies, and credit you unless you prefer to stay
anonymous.

## Supported versions

Only the **latest release** receives security fixes. StudioFlow is developed in the open on `main`; every release is
published as container images with a signature and a software bill of materials (see
[docs/releasing.md](docs/releasing.md)). Update with `./update.sh` (see [docs/runbook.md](docs/runbook.md)).

| Version | Supported |
|---|---|
| Latest release | yes |
| Older releases | no, please update |
| `main` (unreleased) | on a best-effort basis |

## Scope

In scope: the API (`apps/api`), the Regie, the sender and the output page (`apps/studio`, `apps/sender`, `apps/output`),
the Docker images and Compose files, the setup, update, backup and restore scripts, and the way they are configured by
default.

Out of scope: weaknesses in third-party software that we only use (report them to the project, for example LiveKit,
Caddy, PostgreSQL, Angular; tell us if we should pin or update a version), problems that need a compromised server or
browser, and installations that ignore the hardening advice of the [runbook](docs/runbook.md).

## Hardening of an installation

Operators find the advice for a running installation in section 12 ("Security in operation") of
[docs/runbook.md](docs/runbook.md); the security review of the design is [docs/security-review.md](docs/security-review.md).

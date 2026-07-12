# CI + Secret Scanning Design

**Date:** 2026-07-12
**Status:** Approved (pending spec review)
**Branch:** `chore/ci-secret-scanning`

## Goal

Add a Continuous Integration pipeline that gates every pull request (and every push to `main`) on the project's existing test suites, plus automated secret scanning so a credential like the recently-leaked TLS key can never be merged again. Today there is no test/lint gate on PRs — the only workflow (`deploy.yml`) builds the frontend and deploys to GitHub Pages — so regressions and secrets can reach `main` unchecked.

## Scope

**In scope:** one new workflow, `.github/workflows/ci.yml`, running frontend checks, backend tests, and secret scanning. A documented one-time manual step to enable GitHub's native secret scanning + push protection.

**Out of scope:** branch-protection / required-check configuration (GitHub repo settings, done by the maintainer once the checks exist and are green); changes to `deploy.yml`; a local pre-commit hook; aligning `deploy.yml`'s `npm install` to `npm ci` (deferred to stay focused).

## Architecture

A single workflow file with three independent, parallel jobs.

**Triggers:**
```yaml
on:
  pull_request:
    branches: [ main ]
  push:
    branches: [ main ]
```

**Jobs:**

| Job | Runner | Purpose |
|---|---|---|
| `frontend` | `ubuntu-latest`, Node 20 | Type-check, unit tests, production build of the React PWA |
| `backend` | `windows-latest`, Python 3.12 | Run the pytest suite for the Python agent |
| `secret-scan` | `ubuntu-latest` | Fail the build if a secret is detected in the PR / pushed commits |

The jobs are independent (no `needs:`), so they run concurrently and each reports its own status check.

### Job: `frontend`

Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` with `node-version: 20`, `cache: 'npm'`
3. `npm ci` — deterministic install from the committed `package-lock.json`
4. `npx tsc --noEmit` — type check
5. `npx vitest run` — unit tests (currently 49)
6. `npm run build` — confirm the production bundle builds

### Job: `backend`

Runs on `windows-latest` because the agent imports Windows-only libraries (`pycaw`, `comtypes`, `pyautogui`, `winreg`, `ctypes.windll`). Importing the `actions` package loads `pyautogui` and the win32 utilities at test-collection time, so only a Windows runner exercises them faithfully; Ubuntu would require mocking that tests a fiction.

Steps:
1. `actions/checkout@v4`
2. `actions/setup-python@v5` with `python-version: '3.12'` (matches local 3.12.10) and `cache: 'pip'`
3. `pip install -r nexus_desktop/requirements-dev.txt` — this file is `-r ../requirements.txt` + `pytest`; pip resolves the nested `-r` relative to the file's own directory (`nexus_desktop/`), so it installs the root runtime `requirements.txt` **and** pytest. Installing `requirements.txt` alone would miss pytest.
4. `python -m pytest nexus_desktop/tests -q` — run the suite (currently 183 tests)

### Job: `secret-scan`

Steps:
1. `actions/checkout@v4` with `fetch-depth: 0` — full history, the robust default that avoids "base commit not in shallow clone" errors on push events. The repo is small, so the checkout cost is negligible. **Future trim:** once confident, this can drop to the default shallow clone (`fetch-depth: 1`), since gitleaks-action derives the PR commit range from the GitHub API and rarely needs full history.
2. `gitleaks/gitleaks-action@v2` with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`

Uses gitleaks' default behavior: on a pull request it scans the PR's commits; on a push it scans the pushed commits. This keeps the scan low-noise — it does **not** re-scan the entire (already-purged) history on every run, so previously-removed, already-rotated secrets don't produce recurring false failures. If a real secret appears in a new commit, the check fails and blocks the merge.

## Key Decisions

- **Backend runner = Windows.** Dictated by the Windows-only dependency stack; non-negotiable for the tests to run truthfully.
- **Python 3.12.** Matches the developer's local 3.12.10. `requirements.txt` has no version pins, and `cryptography`/`comtypes` builds are version-sensitive, so CI must match the dev environment rather than pin an older 3.11.
- **`npm ci` over `npm install`** in the CI job for reproducible installs from the lockfile.
- **gitleaks default (incremental) scan**, not full-history, because history was already scrubbed of the leaked key; scanning new commits is the right ongoing guard.
- **Public repo → free minutes**, so the Windows runner carries no cost concern.
- **Node 20** in CI matches `deploy.yml` and is current LTS. **Future note:** Node 20 leaves Active LTS in October 2026 — plan to bump CI and `deploy.yml` to Node 22 around then. (Local dev on Node 24 works fine against the Node 20 target.)

## Error Handling / Failure Semantics

Each job fails the workflow (and its status check) on any non-zero step:
- `tsc`/`vitest`/`build` failure → `frontend` check red.
- pytest failure → `backend` check red.
- gitleaks detection → `secret-scan` check red.

Once the maintainer marks these as required checks in branch protection (out-of-scope follow-up), a red check blocks merge.

## Verification Plan

1. Push the branch and open a PR; confirm all three jobs run and go **green**.
2. **Negative test for the secret gate:** in a throwaway commit, add a fake high-entropy secret (e.g. an AWS-key-shaped string), push, and confirm the `secret-scan` job goes **red**; then remove the commit and confirm it returns green. This proves the gate actually catches secrets rather than merely being present.
3. Confirm `deploy.yml` still runs independently and is unaffected.

## Follow-ups (maintainer, documented not automated)

- Enable **Settings → Code security → Secret scanning** and **Push protection** (free on public repos) for push-time blocking before CI even runs.
- After the checks are green once, add them as **required status checks** in branch protection for `main`.

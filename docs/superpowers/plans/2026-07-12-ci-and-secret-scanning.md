# CI + Secret Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `.github/workflows/ci.yml` that gates every PR (and push to `main`) on the frontend checks, backend pytest suite, and gitleaks secret scanning.

**Architecture:** One workflow file with three independent parallel jobs — `frontend` (Ubuntu/Node 20), `backend` (Windows/Python 3.12), `secret-scan` (Ubuntu/gitleaks). The existing `deploy.yml` is untouched and continues to deploy to Pages on push to `main`. Verification happens on a real PR: confirm all three checks go green, then plant a fake secret to prove the scan blocks it.

**Tech Stack:** GitHub Actions; `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`, `gitleaks/gitleaks-action@v2`. No changes to app code.

**Spec:** `docs/superpowers/specs/2026-07-12-ci-and-secret-scanning-design.md`

## Global Constraints

- Branch: `chore/ci-secret-scanning` (already created, spec committed here).
- Backend job MUST run on `windows-latest` — the agent imports Windows-only libs (`pycaw`, `comtypes`, `pyautogui`, `winreg`, `ctypes.windll`) at test-collection time.
- Backend Python version: `3.12` (matches local 3.12.10). No older pin.
- Backend install command MUST be `pip install -r nexus_desktop/requirements-dev.txt` (that file is `-r ../requirements.txt` + `pytest`; installing plain `requirements.txt` misses pytest).
- Frontend uses `npm ci` (deterministic, from committed `package-lock.json`), Node 20.
- gitleaks uses default incremental scan (PR/pushed commits), not full history.
- Commit messages have NO Co-Authored-By trailer.
- Do NOT modify `deploy.yml`.
- Baseline suites the CI must reproduce green: 183 backend tests, 49 frontend tests, `tsc --noEmit` clean, `npm run build` succeeds (verified locally in this session).

---

### Task 1: Create the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing repo scripts — root `package.json` (`build` = `tsc && vite build`; `test` = `vitest run`), committed `package-lock.json`, root `requirements.txt`, `nexus_desktop/requirements-dev.txt`, `nexus_desktop/tests/`.
- Produces: three GitHub status checks named `frontend`, `backend`, `secret-scan` on every PR to `main` and push to `main`.

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/ci.yml` with exactly this content:

```yaml
name: CI

on:
  pull_request:
    branches: [ main ]
  push:
    branches: [ main ]

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run
      - run: npm run build

  backend:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: nexus_desktop/requirements-dev.txt
      - run: pip install -r nexus_desktop/requirements-dev.txt
      - run: python -m pytest nexus_desktop/tests -q

  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Lint the YAML locally**

Run (from repo root):
```bash
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"
```
Expected: `YAML OK` (no traceback). This catches indentation/syntax errors before pushing.

- [ ] **Step 3: Sanity-check the referenced commands exist**

Run:
```bash
python -c "import json; s=json.load(open('package.json'))['scripts']; assert 'build' in s and 'test' in s, s; print('scripts OK:', s)"
test -f nexus_desktop/requirements-dev.txt && echo "dev-reqs OK"
test -f package-lock.json && echo "lockfile OK (npm ci will work)"
```
Expected: `scripts OK: {...}`, `dev-reqs OK`, `lockfile OK (npm ci will work)`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PR-gating workflow (frontend, backend, secret scan)"
```

---

### Task 2: Push, open PR, and verify all three checks pass

**Files:** none (verification only).

**Interfaces:**
- Consumes: Task 1's `ci.yml`.
- Produces: a green CI run on the PR, proving the pipeline works end-to-end.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin chore/ci-secret-scanning
```
Expected: branch created on origin.

- [ ] **Step 2: Open the PR**

`gh` is not installed on this machine. Open the compare URL in a browser and create the PR against `main`:
`https://github.com/Efecancngz/nexus_remoter/compare/main...chore/ci-secret-scanning`

Title: `ci: add PR-gating workflow (frontend, backend, secret scan)`
Body: brief — "Adds CI per `docs/superpowers/specs/2026-07-12-ci-and-secret-scanning-design.md`: frontend (tsc/vitest/build), backend pytest on Windows, gitleaks secret scan."

- [ ] **Step 3: Watch the checks run**

Poll the check-runs for the branch head via the public API (no auth needed for a public repo). First get the pushed HEAD sha:
```bash
git rev-parse HEAD
```
Then (substitute `<sha>`):
```bash
curl -s "https://api.github.com/repos/Efecancngz/nexus_remoter/commits/<sha>/check-runs" \
  | python -c "import sys,json; d=json.load(sys.stdin); [print(c['name'], c['status'], c.get('conclusion')) for c in d['check_runs']]"
```
Expected once complete:
```
frontend completed success
backend completed success
secret-scan completed success
```
(If rate-limited, watch the PR's "Checks" tab in the browser instead.)

- [ ] **Step 4: Confirm the checks are correct, not vacuously passing**

Verify the logs show real work: the `backend` job log contains `183 passed` (or the current count) and the `frontend` job log shows vitest's `49 passed` and a successful `vite build`. Open each job in the PR Checks tab to confirm. This guards against a job that "passes" because a step was silently skipped.

- [ ] **Step 5: No commit** — this task only observes. If any job fails, fix `ci.yml`, commit with message `ci: fix <job> job`, push, and re-observe.

---

### Task 3: Prove the secret gate actually blocks a secret

**Files:**
- Temporary: `.ci-secret-probe` (created then removed — never merged).

**Interfaces:**
- Consumes: Task 2's working pipeline.
- Produces: evidence that `secret-scan` fails on a real secret and recovers when removed (a negative test for the gate).

- [ ] **Step 1: Plant a fake secret on a throwaway commit**

Create a file with a high-entropy, clearly-fake AWS-style key (a known gitleaks pattern), so no real credential is ever involved:
```bash
printf 'AKIAIOSFODNN7EXAMPLE\naws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n' > .ci-secret-probe
git add .ci-secret-probe
git commit -m "test: TEMP planted secret to verify gitleaks gate (will revert)"
git push
```

- [ ] **Step 2: Confirm the secret-scan check goes RED**

Poll check-runs for the new HEAD sha (same curl as Task 2 Step 3), or watch the PR Checks tab.
Expected: `secret-scan completed failure` (frontend/backend still succeed — they don't inspect this file).
This proves the gate catches secrets rather than merely being wired up.

- [ ] **Step 3: Remove the probe and restore green**

```bash
git rm .ci-secret-probe
git commit -m "test: remove planted secret probe"
git push
```

- [ ] **Step 4: Confirm secret-scan returns to success**

Poll check-runs for the newest HEAD sha.
Expected: `secret-scan completed success` again, alongside `frontend` and `backend`.

- [ ] **Step 5: Verify no probe residue**

```bash
git log --oneline -- .ci-secret-probe
test ! -f .ci-secret-probe && echo "probe file gone from working tree"
```
Note: the planted secret still exists in the two throwaway commits' history on the branch. Because it is the published, non-secret AWS **EXAMPLE** key (documented by AWS as a placeholder), this is harmless. If a clean history is desired before merge, squash-merge the PR so the intermediate commits collapse.

---

### Task 4: Document the CI + maintainer follow-ups

**Files:**
- Modify: `CONTRIBUTING.md` (append a short "Continuous Integration" section)

**Interfaces:**
- Consumes: the merged pipeline behavior.
- Produces: contributor-facing docs stating what CI runs and the two one-time maintainer settings.

- [ ] **Step 1: Append the CI section to `CONTRIBUTING.md`**

Add this section immediately before the "Branch & PR conventions" section:

```markdown
## Continuous Integration

Every pull request runs `.github/workflows/ci.yml`, three checks that must pass:

- **frontend** (Ubuntu, Node 20): `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- **backend** (Windows, Python 3.12): `pip install -r nexus_desktop/requirements-dev.txt`, then `python -m pytest nexus_desktop/tests -q`. It runs on Windows because the agent imports Windows-only libraries.
- **secret-scan** (Ubuntu): `gitleaks` fails the build if a credential is detected in the PR's commits.

Run all of these locally before opening a PR (see "Dev setup").

**Maintainer one-time settings** (not automated): enable **Settings → Code security → Secret scanning** and **Push protection**, and after CI is green once, add the three checks as **required status checks** in branch protection for `main`.
```

- [ ] **Step 2: Verify the doc references are accurate**

Run:
```bash
grep -n "requirements-dev.txt" CONTRIBUTING.md && echo "path referenced"
python -c "import yaml; y=yaml.safe_load(open('.github/workflows/ci.yml')); print('jobs:', list(y['jobs'].keys()))"
```
Expected: the grep line prints, and `jobs: ['frontend', 'backend', 'secret-scan']` — confirming the doc's job names match the workflow.

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: document CI checks and maintainer follow-ups in CONTRIBUTING"
git push
```

---

## Self-Review

**Spec coverage:**
- Workflow with 3 jobs + triggers → Task 1. ✓
- Frontend job (Ubuntu/Node 20, tsc/vitest/build, `npm ci`) → Task 1. ✓
- Backend job (Windows/Python 3.12, `requirements-dev.txt`, pytest) → Task 1. ✓
- secret-scan job (gitleaks, `fetch-depth: 0`, incremental) → Task 1. ✓
- Verification plan (green on real PR; negative secret test; deploy.yml unaffected) → Tasks 2 & 3. ✓
- Follow-ups documented (native push protection, required checks) → Task 4. ✓
- `deploy.yml` untouched → no task modifies it; Global Constraints forbids it. ✓

**Placeholder scan:** No TBD/TODO; every step has concrete commands/content and expected output. ✓

**Type/name consistency:** Job names `frontend`/`backend`/`secret-scan` are identical in `ci.yml` (Task 1), the verification polling (Tasks 2–3), and the CONTRIBUTING doc (Task 4). Install path `nexus_desktop/requirements-dev.txt` is identical across the workflow, constraints, and docs. ✓

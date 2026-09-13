# ADR-006: Origin Repository Ownership and Dokku Deployment

- Status: Accepted
- Date: 2026-09-13

## Context

The previous maintainer is leaving the company. The working production baseline is
upstream `main` at `09dc04add6f4d2b5c7c85ed15eda756baa2b8557`. Development and deployment
must continue from Marin's existing repository without moving servers or data.

## Decision

- `marinmestrovic-arch/scouting-platform` (`origin`) is the primary repository for
  development, pull requests, and deployment. `bobasaki/scouting-platform` is a
  historical reference; its Actions workflow and deployment credentials are retired.
- Keep origin in the existing fork network. Historical upstream pull requests and
  issues remain upstream; no ownership transfer or repository deletion is needed.
- Both local branches track origin. Feature work goes through PRs into `dev`, then
  a promotion PR into `main`. Main requires passing `checks` and a PR, with zero
  required reviewers for the sole maintainer. Force pushes and deletion are blocked.
  Migration changes still require another qualified person's review.
- Retain the existing Dokku topology: production at `178.105.218.172` and staging at
  `46.225.18.236`, each running `scouting-web`, `scouting-worker`, and `scouting-db`.
  This supersedes ADR-001's Railway hosting recommendation.
- Only origin's GitHub Actions deploys: `dev` to staging and `main` to production.
  Preserve CI gating and worker -> Prisma migrations -> web -> smoke-check order.
  Use separate replacement SSH credentials for each environment.
- Synchronize origin/local `main` and `dev` to the working baseline before changing
  deployment ownership. Staging's newer upstream-dev history requires one explicit,
  lease-guarded adjustment of its Dokku Git refs; ordinary deploys stay fast-forward.

## Consequences

Marin can maintain and deploy the application without the previous GitHub owner's
account. Servers, domains, database contents, application APIs, runtime secrets, and
provider configuration remain in place. After staging and production verification,
revoke the former CI SSH keys and remove upstream's deployment secrets.

Keep local backup refs and private database backups for the cutover. Application
rollback follows the Dokku runbook and requires schema compatibility; do not use
database down-migrations as a deployment rollback.

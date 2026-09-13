# Contributor Workflow

The primary repository is `marinmestrovic-arch/scouting-platform` (`origin`).
`dev` deploys to staging and `main` deploys to production after CI passes.
`upstream` is retained only for historical reference.

## Local setup

```bash
git remote set-url origin git@github-arch:marinmestrovic-arch/scouting-platform.git
git remote set-url --push upstream DISABLED
git fetch origin
git branch --set-upstream-to=origin/main main
git branch --set-upstream-to=origin/dev dev
git config remote.pushDefault origin
git config push.default simple
gh repo set-default marinmestrovic-arch/scouting-platform
```

The `github-arch` SSH alias must authenticate as `marinmestrovic-arch`. GitHub CLI
operations also need that account; check `gh auth status` before changing settings.

## Feature work

```bash
git switch dev
git pull --ff-only
git switch -c codex/<short-name>
# Make changes, run the relevant checks, and commit.
git push -u origin HEAD
gh pr create --repo marinmestrovic-arch/scouting-platform --base dev --fill
```

Wait for CI, review the diff, and merge the PR into `dev`. The resulting push deploys
staging. Verify staging before promoting to production. Never rebase or force-push
the shared `main` or `dev` branch.

## Production promotion

```bash
gh pr create --repo marinmestrovic-arch/scouting-platform --base main --head dev --fill
```

`main` requires a PR and passing `checks`, including for admins. No reviewer approval
is required while Marin is the sole maintainer; schema migrations still require
another qualified person's review. Merge the promotion PR with a merge commit so
the shared branch histories stay connected, then wait for production deployment.

If no newer work has landed on `dev`, synchronize it to the promotion merge:

```bash
git fetch origin
git switch main
git merge --ff-only origin/main
git switch dev
git merge --ff-only origin/dev
git merge --ff-only origin/main
git push origin dev
```

If `dev` has advanced independently, use a PR to merge `main` back into `dev`; do not
reset it or discard newer work. The resulting dev push runs staging deployment.

See the [Dokku runbook](./setup/dokku.md) for credentials, verification, and rollback.

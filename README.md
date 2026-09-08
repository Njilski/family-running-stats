# Family Running Stats

A small self-hosted page where the family logs runs and watches the numbers
add up: kilometres per month, year-to-date lines, personal bests, family
records, week streaks. Anyone with the link can look; the family password
unlocks editing.

Built on the same stack as the Opus speaker portal so the two are maintained
the same way: Node/Express, Firestore (JSON file locally), Cloud Run, automatic
deploys from GitHub via Workload Identity Federation.

## Quick start

```bash
npm install
npm start
```

Open http://localhost:3000. Locally the edit password is `run` (unless you set
`EDIT_PASSWORD`), and data lives in `data/store.json`.

## Testing

```bash
rm -rf data && node server.js &
CHROMIUM=/opt/pw-browsers/chromium node smoke-test.mjs   # or just: node smoke-test.mjs
```

The smoke test checks the stats maths directly, then drives a real browser
through unlock, runners, logging, editing, deleting, records, charts, export and
lock. Run it before every commit. It needs an empty store.

## What's where

```
server.js               Express: public read API, password unlock, members and runs CRUD
src/stats.js            Every number on the dashboard is computed here, server-side
src/model.js            Run/member shape and validation shared by the API and stores
src/store.js            Storage facade: Firestore on Cloud Run, JSON file locally
src/store-firestore.js  Collections running_members, running_runs
src/store-json.js       data/store.json — same async API
public/index.html       The one page: stats, charts, runners, records, run log, modals
public/app.js           Renders /api/summary; every edit re-fetches
public/charts.js        Hand-rolled SVG charts (monthly bars, cumulative lines)
public/styles.css       Token layer on Bootstrap 5.3.3 + validated chart palette
smoke-test.mjs          Headless end-to-end test (Playwright)
.github/workflows/      Auto-deploy to Cloud Run on push to main
CLAUDE.md               Working notes for whoever picks this up next
```

## Environment

| Variable | Effect |
|---|---|
| `EDIT_PASSWORD` | The family password. Locally defaults to `run`; **in production a missing value disables editing** rather than opening it up. |
| `SESSION_SECRET` | Signs the edit cookie. |
| `PORT` | Local port (default 3000; Cloud Run injects its own). |
| `K_SERVICE` / `USE_FIRESTORE=1` | Switches storage to Firestore. Set automatically on Cloud Run. |

## Deploying

**Push to `main` and it deploys itself.** `.github/workflows/deploy.yml` builds
from source and releases to Cloud Run using Workload Identity Federation, so no
service-account key exists anywhere. Markdown-only pushes skip the deploy.

Project `athenas-1537948714332`, region `europe-west1`, service
`family-running-stats`. Storage is Firestore in that project, collections
`running_members` and `running_runs` (prefixed because the project is shared).

### One-time setup (already done? see CLAUDE.md → Status)

Run in Cloud Shell for the project. The pool `github` and the deployer service
account `portal-deployer` already exist from the speaker portal; this adds a
provider pinned to this repo and lets it impersonate the same deployer.

```bash
PROJECT=athenas-1537948714332
PROJECT_NUMBER=731133621844
REPO=Njilski/family-running-stats
SA=portal-deployer@$PROJECT.iam.gserviceaccount.com

# 1. A WIF provider that only accepts tokens minted for this repo
gcloud iam workload-identity-pools providers create-oidc family-running-stats \
  --project=$PROJECT --location=global --workload-identity-pool=github \
  --display-name="GitHub: family-running-stats" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '$REPO'"

# 2. Let that repo's workflows act as the deployer
gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# 3. Secrets (type them in; never paste them into a chat)
printf 'THE_FAMILY_PASSWORD' | gcloud secrets create running-edit-password --data-file=- --project=$PROJECT
openssl rand -base64 48 | gcloud secrets create running-session-secret --data-file=- --project=$PROJECT
```

Then push to `main` once. The first deploy creates the service (public,
editing disabled because no password is attached yet). Attach the secrets:

```bash
RUNTIME_SA=$(gcloud run services describe family-running-stats --region europe-west1 --project $PROJECT --format='value(spec.template.spec.serviceAccountName)')
RUNTIME_SA=${RUNTIME_SA:-$PROJECT_NUMBER-compute@developer.gserviceaccount.com}
for s in running-edit-password running-session-secret; do
  gcloud secrets add-iam-policy-binding $s --project=$PROJECT \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
done
gcloud run services update family-running-stats --region europe-west1 --project $PROJECT \
  --set-secrets EDIT_PASSWORD=running-edit-password:latest,SESSION_SECRET=running-session-secret:latest
```

Later deploys keep those. If you ever add an env var by hand use
`--update-env-vars`, never `--set-env-vars` (which replaces the whole set).

A manual deploy, should you need one:

```bash
gcloud run deploy family-running-stats --source . \
  --region europe-west1 --project athenas-1537948714332 --allow-unauthenticated --quiet
```

## Roadmap

- **Strava**: per-runner OAuth connect, webhook-driven import. Runs land with
  `source: 'strava'` and `externalId` = activity id, so re-imports are idempotent.
- **Apple Health**: no server API exists; the plan is an iOS Shortcut that posts
  the day's workouts to an import endpoint with a per-runner token
  (`source: 'apple_health'`).
- Manual runs stay editable; imported runs would be read-only in the UI.

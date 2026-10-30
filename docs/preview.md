# Digest preview

The preview is a single self-contained, server-rendered HTML file with the usual lane
banner. The running service binds only to `127.0.0.1`; it is never the public host.
The public copy is https://madpawel.github.io/rig-handover-s01e04/.

## Export locally

From the repository root, with dependencies available and Node 24:

```sh
scripts/export-preview.sh var/preview/index.html
```

The script starts the actual server using
`./node_modules/.bin/tsx --env-file-if-exists=.env src/server.ts`, waits up to ten
seconds for its own listen callback, and uses `curl --fail` to fetch
`/digest/2026-10-28`. `PREVIEW_PORT` selects a dedicated port (default `18787`).
It terminates only its own background process on exit. An occupied port causes failure,
not a fetch from another instance. Server output is private and removed on exit.
The export is checked for inline styling and absence of external resources/client scripts.

An output filename is optional. Inside this repository only ignored `var/` is allowed;
an external path such as `$RUNNER_TEMP/rig-preview/index.html` is also accepted.
Never stage exported HTML, `.env`, or marker values. Do not print HTML or secrets in logs,
issue comments, or chat attachments. The banner reads the environment automatically;
there is no marker literal in the tooling.

For cleanup, explicitly override any value in `.env`:

```sh
LANE_MARKER='' scripts/export-preview.sh var/preview/index.html
```

## Manual publication and replacement

Public initial publication and subsequent replacement are approval gates: the coordinator
must confirm human approval before each operation. Workers do not push, set secrets,
dispatch workflows, publish, submit the reviewer link, or close the preview issue.
The approved coordinator configures GitHub Pages to use Actions and supplies the
`LANE_MARKER` repository secret without logging it.

After the tooling and digest dependencies are reviewed and merged, the coordinator runs:

```sh
gh workflow run preview.yml --repo madpawel/rig-handover-s01e04 -f include_marker=true
```

This intentionally fails if the marker secret is empty. There are no push triggers.
The workflow tests and typechecks, exports only `index.html` into a temporary directory,
and deploys it through the `github-pages` environment. Deployments share one concurrency
group and do not cancel an in-progress deployment. Send the public HTTPS URL and plan's
issue links to the reviewer after verifying the deployment, without copying marker data.
That reviewer submission, not the tooling commit, satisfies issue #6's done condition.

After review and explicit human cleanup approval, replace the same URL:

```sh
gh workflow run preview.yml --repo madpawel/rig-handover-s01e04 -f include_marker=false
```

The empty `LANE_MARKER` override produces “no marker set”, even if `.env` exists.
Verify the replacement at the same URL before declaring cleanup done. A local export
alone does not replace the public copy. Plan archival remains the cleanup owner's work.

The workflow deletes only its own uploaded Actions artifact after deployment (also on
failure), so the marker copy is not retained as a downloadable build artifact. Retention
is additionally limited to one day. If deletion fails, the workflow reports failure;
the coordinator must investigate that artifact specifically. No unrelated artifacts or
Git history are deleted. Public publishing still exposes the marker until replacement;
artifact deletion is not a substitute for approved cleanup.

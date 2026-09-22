# GitHub Source Control for Coding

PeakUI imports repositories through a **GitHub App**. This is intentionally not
a personal-access-token field: the GitHub installation controls the selected
repositories, and PeakUI creates short-lived, repository-scoped installation
tokens only while an import is running.

## Deployment setup

1. Create a GitHub App owned by the account or organization that will grant
   repository access.
2. Set its **Setup URL** to:
   `https://YOUR-PEAKUI-HOST/api/integrations/github/callback`
3. Request only these repository permissions for the initial release:
   - `Metadata`: read-only
   - `Contents`: read/write (read is sufficient for import; write is reserved
     for the forthcoming commit/push workflow)
4. Let users choose **Only select repositories** during installation.
5. Generate a private key and configure the following server environment:

```dotenv
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=peakui-source-control
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----"
```

Never add the PEM to git, a browser setting, a chat message, or an agent prompt.
Restart/redeploy the app after adding it.

## User workflow

- In Coding, open **Settings** and connect GitHub. GitHub displays the
  installation and selected-repository permission screen.
- Open **Projects**, choose an allowed repository and branch, then import it.
- PeakUI clones into `/workspace/projects/<server-generated UUID>` and creates
  a new coding session bound permanently to that directory.
- Choose an imported project to open a fresh session for it. Existing sessions
  retain their original project binding.

## Security boundaries

- The browser submits a GitHub repository ID, never a clone URL or filesystem
  path. The server re-fetches the allowed repository list before cloning.
- The app mounts the coder volume at `/coder-workspace` only for the dedicated
  import route. The agent cannot choose an app-side destination.
- Clone authentication uses Git's in-memory extra header configuration. Tokens
  do not appear in command arguments, `.git/config`, the database, or logs.
- The generated installation token is restricted to the selected repository and
  expires on GitHub's normal installation-token schedule.
- Disconnecting removes the PeakUI user-to-installation association. It does
  not uninstall the GitHub App; uninstalling remains under the user's GitHub
  account control.

## Deliberately deferred

The first release imports and opens projects. Pull, commit, push, pull-request,
and deployment actions should be added as explicit, auditable APIs with user
approval, rather than exposed as unconstrained agent shell commands. Webhook
support must validate `X-Hub-Signature-256`, deduplicate delivery IDs, and queue
processing outside the request handler.

The same `GitHubConnection` / `CoderProject` pattern is the intended extension
point for GitLab, Bitbucket, Vercel, Sentry, Linear, and deployment providers.

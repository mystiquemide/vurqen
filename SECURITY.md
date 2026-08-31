# Security

Vurqen handles exchange API credentials and provider responses. Keep credentials in an untracked `.env.local` file or a secret manager. Never commit API keys, passphrases, or withdrawal credentials.

The default integration target is simulated or read-only access. Production deployments must set `VURQEN_API_TOKEN` before exposing private API routes.

To report a security issue, open a private GitHub security advisory for the repository owner. Do not publish credentials or an exploitable proof in a public issue.

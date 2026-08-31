# Security

Vurqen handles exchange API credentials and provider responses. Keep credentials in an untracked `.env.local` file or a secret manager. Never commit API keys, passphrases, or withdrawal credentials.

The default integration target is simulated or read-only access. Production deployments must set `VURQEN_API_TOKEN` before exposing private API routes.
The bundled server speaks plain HTTP, so production deployments must place it behind a TLS-terminating reverse proxy before sending credentials or private data.
Evidence supplied to a reconciliation may be sent to the configured Gemini or Groq provider for explanation. Do not place secrets in replay payloads or provider responses.
The default file store is single-process. Do not run multiple Vurqen instances against the same `VURQEN_DATA_DIR` without replacing it with a coordinated datastore.

To report a security issue, open a private GitHub security advisory for the repository owner. Do not publish credentials or an exploitable proof in a public issue.

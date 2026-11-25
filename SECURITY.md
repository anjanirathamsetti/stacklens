# Security

Please report vulnerabilities privately via GitHub's **Security → Report a vulnerability** on this repository rather than in public issues.

Things worth knowing when deploying:

- The server has no built-in authentication. Run it behind your VPN, SSO proxy or ingress auth.
- Traces can contain request data. The SDK redacts common sensitive keys (`password`, `token`, `authorization`, `cookie`, `apiKey`, card numbers…) by default; extend `redactKeys` for your domain.
- Keep `DATABASE_URL` and `SERVICENOW_*` credentials in your secret manager or environment, never in the repository.

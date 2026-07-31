# Source Security Report v13

Generated: 2026-07-31T16:56:44+08:00

- Production secret/private-key findings: **0**
- Test-only secret-like literals: **6**
- Uploaded workbook integrity matches: **9/9**
- `.dev.vars` and production exports are excluded by release policy.
- The D1 `database_id` in `wrangler.toml` is an infrastructure identifier, not an authentication secret.

The six pattern matches are password strings used only by authentication test fixtures in root compatibility tests and `test/`. They are not read by the Worker at runtime and are not production credentials.

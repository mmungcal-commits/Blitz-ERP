# E88 FinSys v7.1 Release Manifest

- Payload files: **98**
- Uncompressed payload: **45.5 MB**
- Opening workbooks: **14**
- Opening SQL chunks: **13**
- Data self-tests: **29/29 passed**
- Unit tests: **3/3 passed**
- Structure/static checks: **passed**
- Readable credential values in deployment sources: **0**

## Critical release contents

- `source_data/`: actual operational Excel source workbooks with credential fields redacted
- `migrations/opening/`: data-loaded D1 SQL chunks
- `reports/`: self-test, source security, and data-load evidence
- `src/` and `public/`: Worker/API and responsive ERP client
- `scripts/`: data generator, guarded database bootstrap, pre-deploy guard, and smoke test
- `.github/workflows/`: CI, manual deploy, and confirmation-gated new-D1 bootstrap/deploy

See `RELEASE_MANIFEST.json` for SHA-256 hashes of every payload file. The manifest files themselves are intentionally excluded from self-hashing.

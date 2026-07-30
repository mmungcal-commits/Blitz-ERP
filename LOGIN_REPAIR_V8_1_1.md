# E88 FinSys v8.1.1 Login Repair

## Corrected behavior

1. Opening the existing E88 FinSys URL displays the E88-branded sign-in page when no valid session exists.
2. Only pre-registered, active `@nrdev.ph` users with LIVE access can sign in.
3. New users receive a one-time activation link and create their own password.
4. Administrators can activate, deactivate, assign roles, grant LIVE access, and issue password-reset links.
5. Administrators never receive password values or password hashes.
6. Five failed password attempts temporarily lock the account for 15 minutes.
7. Successful login creates a 12-hour Secure, HttpOnly, SameSite session.
8. Cloudflare Access remains supported as an optional additional layer.

## Production repair

1. Upload this package into `mmungcal-commits/e88-erp`, preserving all folders.
2. Open **Actions**.
3. Select **Repair E88 FinSys Login and Deploy**.
4. Select **Run workflow**.
5. Enter `E88_REPAIR_LOGIN`.
6. Run the workflow.
7. Open the same E88 FinSys URL in a private browser window.

For the existing administrator, sign in as `mmungcal@nrdev.ph` using the existing E88 FinSys `APP_PASS`. This is accepted only while the administrator has no individual credential. After the first successful sign-in, the password is stored only as an individual salted hash.

Do not rerun the opening-data bootstrap. The repair action applies only the additive authentication tables and deploys the corrected Worker.

# CampusFind — manual release acceptance checklist

Use this checklist against the actual deployed site and the intended Supabase project. Record the date, deployment URL, and Supabase project ID (never record credentials). Do not use production data for destructive tests.

## 1. Before testing

- [ ] Confirm the website deployment is the expected latest version.
- [ ] Confirm the Supabase project ID used by the browser app, server functions, and Edge Functions is the intended project.
- [ ] Confirm required environment variables exist in the hosting dashboard without copying secret values into notes.
- [ ] Confirm the service-role key previously exposed in Git history has been rotated and updated in hosting.
- [ ] Confirm the database migration history matches the repository migrations.
- [ ] Take or verify a fresh backup before testing workflows that change data.
- [ ] Confirm the GitHub Actions CI run for the candidate release is green.

## 2. Student authentication

Use a test student account and a phone number you control.

- [ ] Create an account with full name, university UID, mobile number, and password.
- [ ] Receive and verify the six-digit phone OTP.
- [ ] Confirm one profile is created with the correct normalized UID and the student role.
- [ ] Try an invalid phone number and an invalid UID; confirm clear validation errors.
- [ ] Try a duplicate UID and a phone number already used by another account; confirm safe failure without account takeover.
- [ ] Sign out, then sign in using UID/password.
- [ ] Sign out, then test phone-code sign-in if that option is enabled in the deployment.
- [ ] Test password recovery: request a code, verify it, set a new password, and sign in with the new password.
- [ ] Test an incorrect and an expired OTP, a wrong password, and an unknown UID; verify safe and consistent messages.
- [ ] Verify session persistence, refresh, expiry, and sign-out behaviour.

## 3. Student features

- [ ] Browse Lost and Found reports while signed in.
- [ ] Search by item name, category, and common synonym/typo.
- [ ] Apply type, campus location, report status, and date filters.
- [ ] Change sort order and load another page; verify there are no duplicated/missing results.
- [ ] Save and unsave an item; enable saved-only filtering.
- [ ] Submit a Lost report and a Found report using valid campus-area choices.
- [ ] Try an out-of-scope location and confirm it cannot be submitted.
- [ ] Upload a valid JPG, PNG, and WebP photo; verify image compression and display.
- [ ] Try an invalid file type and a file larger than 5 MB; confirm rejection.
- [ ] Confirm the student can see only their own reports, claims, and private notifications in My Reports.
- [ ] Submit a claim with evidence for a found item; confirm the claim status appears in My Reports.
- [ ] Confirm notification preferences and available notifications behave as expected.

## 4. Matching and notifications

Use two test student accounts and reports that do not contain real personal information.

- [ ] Create an opposite-type Lost/Found pair with similar name, category, brand/colour/model, date, and campus area.
- [ ] Confirm a possible match is generated and available for administrator review.
- [ ] Confirm unrelated reports do not create misleading matches.
- [ ] Confirm returned, closed, or moderated reports do not trigger new match notifications.
- [ ] Trigger repeated matching requests and confirm rate limiting responds safely.
- [ ] Confirm each student can see only notifications belonging to their own account.

## 5. Administrator workspace

Use a dedicated administrator account.

- [ ] Sign in and confirm the administrator workspace is visually separate from the student workspace.
- [ ] Confirm an ordinary student cannot open the admin route or call administrator actions directly.
- [ ] Confirm the administrator can view Lost and Found reports, student verification status, claims, possible matches, and audit history.
- [ ] Verify a student, then confirm the verification status is updated.
- [ ] Review a possible match; test confirm and dismiss on separate test pairs.
- [ ] Review a claim; test approve, reject, and complete on separate test claims.
- [ ] Add a private moderation note and confirm it is visible only to administrators.
- [ ] Change a report moderation/status value and confirm the audit record is created.
- [ ] Confirm the admin activity view shows student sign-ins and does not expose passwords, OTPs, tokens, or private claim evidence.
- [ ] Confirm no campus map, map panel, exact pin control, or precise coordinates appear anywhere in the public, student, or administrator interfaces.

## 6. Access-control and security checks

With two ordinary student accounts (A and B):

- [ ] A cannot read or change B's profile.
- [ ] A cannot edit or delete B's report.
- [ ] A cannot read B's private claim evidence, saved items, notification preferences, or private notifications.
- [ ] A cannot create or change administrator verification, moderation, claim-review, match-review, or audit records.
- [ ] Unauthenticated visitors cannot upload images or submit claims.
- [ ] Direct Storage access does not expose private image objects without an allowed signed URL.
- [ ] Confirm production/browser assets do not contain the service-role key or other server secrets.
- [ ] Review logs for exposed UID, phone number, password, OTP, token, or claim evidence.

## 7. Backup and recovery checks

- [ ] Add `SUPABASE_DB_URL` and `CAMPUSFIND_BACKUP_PASSPHRASE` in GitHub repository Actions secrets.
- [ ] Run the database-backup workflow manually and confirm it succeeds.
- [ ] Download the artifact and confirm it contains a `.dump.gpg` file, not a plaintext `.dump`.
- [ ] Decrypt the artifact with the separately stored passphrase and run `pg_restore --list`.
- [ ] Restore it into a separate non-production database and verify profiles/Auth references, reports, claims, matches, notifications, and Storage metadata.
- [ ] Confirm the Mac LaunchAgent is loaded and the latest scheduled backup log says success.
- [ ] Confirm Google Drive on the web contains a recent backup file; a local synced-folder copy alone is not proof of cloud upload.
- [ ] Keep the backup passphrase separate from the encrypted backup file.

## 8. Browser, mobile, and release checks

- [ ] Check homepage, sign-in, browse, report, My Reports, and admin pages at a narrow mobile width (around 375 px).
- [ ] Confirm there is no horizontal page overflow and the mobile menu opens/closes correctly.
- [ ] Navigate forms and dialogs by keyboard; confirm visible focus, labels, and useful error messages.
- [ ] Check image loading, empty states, loading states, and failure/retry states.
- [ ] Confirm page titles and meta descriptions are correct for the main routes; authenticated admin/private pages should not be indexed.
- [ ] Check footer links, 404 behaviour, and all visible buttons/navigation links.
- [ ] Confirm health endpoints, HTTPS, and production deployment status.
- [ ] Record every failed test with the route, account role, browser/device, exact error, and timestamp. Never include passwords, OTPs, tokens, or keys.

## Sign-off

- Date:
- Deployment URL:
- Supabase project ID:
- Git commit:
- CI run:
- Passed checks:
- Failed checks / evidence:
- Outstanding blockers:

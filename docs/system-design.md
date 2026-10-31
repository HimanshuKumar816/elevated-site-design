# System Design — CampusFind

## Product

CampusFind is a single-campus lost-and-found service for Chandigarh University. It helps students report lost or found belongings, search reports, submit ownership claims, and complete a safe return through administrator review.

## Roles and access

- **Visitor:** can use the public information pages and the explicitly public lost-and-found browsing experience. A visitor cannot create a report, submit a claim, view private student activity, or access administrator tools.
- **Student:** signs up with full name, university UID, and a mobile number verified by an OTP. A password is set for later UID/password sign-in. Phone-code sign-in and phone-based password recovery are also available in the application code. Students can browse, report items, save reports, receive notifications, submit claims, and track their own reports and claims.
- **Administrator:** uses an authenticated account with the administrator role. The administrator workspace supports student verification, report review and moderation, possible-match review, claim decisions, moderation notes, audit history, student sign-in activity, and campus-level report insights.
- **Operator:** manages the repository, hosting, database credentials, migrations, backups, incident response, and release process. Operator access is not a substitute for the application administrator role.

## Main workflows

1. **Account creation:** collect the student's name, UID, and mobile number; verify the phone with an OTP; set the account password; create the corresponding profile with a normalized unique UID.
2. **Sign-in and recovery:** authenticate by UID/password or phone code where enabled. Verify a phone code before allowing password recovery.
3. **Report an item:** choose Lost or Found, enter the item name/category, campus area, date and relevant descriptors (such as brand, colour, and model), add an optional note, and upload an allowed item photo.
4. **Browse and discover:** search with type/category, location, status, date and saved-item filters; sort and paginate results; view only images returned through short-lived signed URLs.
5. **Save and claim:** students can bookmark reports and submit evidence for a found item. Claim evidence is private to the claimant and administrators.
6. **Matching and notification:** compare opposite-type reports using item descriptors, date, place and text. Possible matches are persisted for administrator review; notifications should exclude closed, inactive, or moderated reports.
7. **Administrator review:** verify students, moderate reports, review possible matches and claims, record private moderation notes, and review audit history. Decisions update report lifecycle states and notify affected students.
8. **Return and closure:** an administrator records an approved claim or confirmed match and the final return status. Students can see the status of their own reports and claims.

## Data and sensitivity

- Supabase Auth owns credentials and sessions. Never store raw passwords in application tables.
- Profiles contain the Auth user ID, normalized unique UID, display name, role, and verification state.
- Item reports contain the owner ID, Lost/Found type, item descriptors, campus area, date, status, moderation state, and optional image path.
- Claims, match reviews, notifications, saved reports, login events, and administrator audit records are separate records with role- and owner-scoped access.
- UIDs, phone numbers, email addresses, claim evidence, precise location information, auth tokens, and service-role credentials are sensitive. Do not expose them in public reports, browser bundles, URLs, or logs.

## Location and map privacy

CampusFind is scoped to Chandigarh University. Report forms use a controlled list of campus areas with an optional local detail. Do not accept or display a location outside the campus scope.

A public-facing map is not part of the product requirement. Do not display a map or precise coordinates on the homepage, visitor pages, or the student browsing board. The authenticated administrator workspace contains a Leaflet campus map using OpenStreetMap tiles. Administrators can view saved report pins and assign or move a pin on the campus-bounded map. The map component is rendered only on the role-guarded administrator route; it is not included on visitor, homepage, or student pages. Pin coordinates are stored in the private `item_locations` table, which uses owner/admin row-level security and a database in-campus coordinate constraint. Students can access their own precise location records under the owner policy; administrators can review report pins. The map bounds are a rectangular campus-area boundary, not a surveyed cadastral polygon.

## Security requirements

- Supabase Auth owns password hashing and session lifecycle.
- Normalize and validate UIDs consistently. Do not reveal whether a UID or phone number exists through different public error messages.
- Service-role credentials are server-only and bypass RLS. Use them only in trusted server-side functions.
- Enable and verify RLS for every user-owned or private table. Test cross-account access with two separate student accounts.
- Enforce ownership and administrator-role checks on the server/database, not only through hidden UI links or client-side route guards.
- Validate and bound all input. Validate image type and size before upload and keep storage private with signed access URLs.
- Apply rate limits to authentication, matching, and other abuse-prone operations.
- Keep secrets out of Git history; rotating a secret is required if it was ever committed.

## Non-functional requirements

- Responsive layout for mobile and desktop, including keyboard access, visible focus states, accessible labels, and loading/empty/error/success states.
- Paginate lists and bound database queries.
- Keep image payloads reasonably small and use signed URLs for private storage.
- Provide operational health checks, documented migrations, automated backups, and a tested restore procedure.
- Keep deployment and monitoring proportional to a single-campus service.

## Out of scope for the current product

Payments, subscription billing, multi-university tenancy, public live location tracking, direct student-to-student chat, AI image recognition, Kubernetes, and microservices. An administrator-only campus map remains unimplemented until verified campus geometry and an approved data-access design are available.

## Privacy and operational requirements

- Publish a privacy notice explaining what student identity, contact, report, image, login, and claim data is collected and who can access it.
- Define retention and deletion rules for student accounts, item photos, closed reports, claims, and audit records.
- Confirm provider backup retention, restore access, and incident contacts before launch.
- Do not describe a migration, deployment, backup, restore, alert, or login flow as complete without evidence from the actual target environment.

## Open release decisions

- Confirm the exact Supabase project used by local development and each deployment environment.
- Decide how historical users, reports, images, and storage objects are migrated to the new backend; do not imply the new project already contains historical data.
- Confirm the live SMS provider, sender configuration, OTP limits, and phone recovery behaviour.
- Confirm whether public visitors may browse report summaries and exactly which item/location fields are safe to expose.
- Approve the university-specific privacy notice, retention policy, and incident contacts.

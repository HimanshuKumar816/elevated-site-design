# CampusFind permissions

## Permission matrix

| Action | Visitor | Signed-in student |
|---|---:|---:|
| View homepage and how-it-works | Yes | Yes |
| Browse lost/found reports | Per current public route design | Yes |
| Create an item report | No | Yes |
| Update own report | No | Yes |
| Delete own report | No | Yes |
| Update another student's report | No | No |
| Read another student's private profile fields | No | No |
| Sign out | No | Yes |

## Enforcement
- Supabase Auth validates identity.
- Postgres Row Level Security is the final enforcement layer.
- items.user_id must equal auth.uid() for inserts, updates, and deletes.
- Profile reads/updates should be scoped to auth.uid() = profiles.id; UID-to-email mapping stays server-side.
- Public item browsing is an intentional product choice; never expose profile emails or auth metadata in public reports.

## Verification required before launch
Use two distinct test accounts. Verify each can create their own report, cannot edit/delete the other's report by direct API call, and cannot query the other's profile via the browser client.

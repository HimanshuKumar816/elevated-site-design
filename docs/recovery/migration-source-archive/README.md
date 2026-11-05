# Recovered Supabase migration sources

These three SQL files were copied byte-for-byte from reachable Git blob objects. They are retained as evidence only; they are not in `supabase/migrations/` and must not be replayed as a recovery chain without a reviewed, isolated database test.

| Live ledger version                                           | Git blob                                   | SHA-256                                                            | Archive file                                                  |
| ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `20261021061513` (`uid_auth_repair`)                          | `19c181be988c0905c9c4e43b69984d7183da727f` | `6c5e129edbedbbf405c348cb771d47d3b262d8c974fd9ca0e31a88a7c7c181db` | `20261021061513_uid_auth_repair.sql`                          |
| `20261021061533` (`restrict_auth_trigger_function_execution`) | `7a58e989e029cf359c251afd96e58bf198b0b28e` | `961b00deaea096b749224cab80be9207a4a8496761ea5c8b856d0ae93d7bc20a` | `20261021061533_restrict_auth_trigger_function_execution.sql` |
| `20261101121508` (`campusfind_canonical_recovery`)            | `a1cac85980fc21f75cda966fce40eb1dc926392e` | `b12ea114951a6888b4cbd2b0804ba3b0ffc859ba927021ff3570664ee6ca9136` | `20261101121508_campusfind_canonical_recovery.sql`            |

The blobs are reachable from the current Git object graph (the `git log --all --find-object` result identifies commit `0aad1086f7a41ef060f226ff37ede0f93388c290`). A scan found no credential-shaped literals in these three archived files.

## Unresolved live ledger entries

The live ledger for project `vmpyjsmxynundpufyaqs` currently records six versions:

1. `20261021061513` — `uid_auth_repair`
2. `20261021061533` — `restrict_auth_trigger_function_execution`
3. `20261101121508` — `campusfind_canonical_recovery`
4. `20261104181031` — `simplify_student_notifications`
5. `20261104181037` — `simplify_report_status_notifications`
6. `20261104182350` — `dsw_physical_custody_workflow`

The exact SQL for the final three versions has not been recovered from reachable or unreachable local Git objects. The repository has similarly named migrations with different versions for the first and third entries; filename similarity does not establish that their contents equal the SQL already applied. There is no repository source for the second entry. Do not rename those files, mark any migration applied, or create replacement SQL to fill these gaps.

The active repository contains 30 migration files, while the live ledger contains six rows. The schema may include work performed outside the recorded migration chain, so the ledger cannot be reconciled by file count or by replaying the repository directory. No production migration or migration-history edit was performed.

## Safest next reconciliation step

Obtain the original SQL for the three unresolved live ledger versions from the development workstation, CI artifacts, or a verified source backup. Compare them against their ledger names and hashes, then diff the current live schema against a disposable PostgreSQL 17 instance. Keep recovered history under this archive until the entire active chain can be replayed safely. Only then prepare a forward-only additive migration from a reviewed live-schema snapshot, test it on an isolated project, take a new production backup, and apply it through the approved deployment process.

## Local replay evidence

PostgreSQL 17.11 is installed locally, so I tested without Docker using a temporary, Unix-socket-only PostgreSQL cluster and empty Auth/Storage stubs. With only the recorded Drizzle baseline (`0000_migration.sql`) before the Supabase files, `20261028145000_move_is_admin_helper_to_private_schema.sql` failed because `profiles.role` was missing; the column is introduced by the unjournaled `0011_admin_role.sql` file. I then applied all 12 Drizzle SQL files in filename order as a diagnostic prerequisite; all 12 passed, but that sequence is not recorded in the journal. The Supabase sequence then passed its first nine files and failed at `20261030182055_campusfind_trust_and_discovery.sql` because `public.item_claims` did not exist. The later `20261030222000_add_end_to_end_claims_and_moderation.sql` creates that table. These are confirmed dependency and ordering gaps in the sources as currently ordered. The temporary cluster was stopped and removed after the tests.

The Drizzle journal contains only `0000_migration`, so the other 11 Drizzle files cannot be treated as a recorded canonical chain. Passing them in numeric order is a compatibility diagnostic, not proof that they were applied in that order to production.

No production database write, reset, deploy, or migration-history repair was attempted.

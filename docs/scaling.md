# Scaling readiness

## Current stage
Keep the application as a stateless modular monolith on Lovable and Supabase. Do not add microservices, Kubernetes, Redis, sharding, or background queues without measurements that justify the cost.

## First bottlenecks to measure
1. Unbounded item-list queries and missing pagination.
2. Missing indexes for item creation time, type, category, and owner ID.
3. Supabase request latency or provider limits.
4. Repeated client requests caused by cache invalidation or component behavior.

## Before increasing infrastructure
- Record baseline response latency and error rate for homepage, auth, browse, and report flows.
- Inspect query plans for the highest-volume queries.
- Add cursor pagination before item volume makes full-list queries expensive.
- Run a load test against staging with test data and report p50/p95/p99, errors, and concurrency.
- Re-test auth and RLS with multiple accounts during load.
- Estimate provider cost at 10x and 100x actual usage before upgrading.

## Status
No load test or cost estimate using live usage has been run, so no performance numbers are claimed.

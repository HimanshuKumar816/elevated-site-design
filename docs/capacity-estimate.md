# Capacity estimate (illustrative, not measured)

## Product and tenancy
CampusFind serves one university campus. It is not a multi-tenant commercial SaaS, so an organization_id field would add complexity without a current product need. User separation is enforced by Auth identity and row-level security.

## Planning scenario
No production traffic analytics are available. For initial planning only, assume 5,000 registered students, 500 daily active students, and 2,000 item reports total in the first year. These are planning assumptions, not observed numbers or promises.

If 500 daily active students each make 10 page/API actions per day, that is 5,000 actions/day. Averaged across 24 hours, this is about 0.06 actions/second. A 10x burst factor suggests a rough peak of 0.6 actions/second. Real traffic is bursty around class times, so this is only a back-of-envelope estimate.

## Storage
Item reports are small relational records. If 2,000 reports average 2 KB of text and metadata, row payload is about 4 MB before indexes and database overhead. The current schema has no image/file upload feature, so no object-storage estimate is included.

## Likely first bottlenecks
1. Incorrect or mismatched backend configuration preventing auth.
2. Unbounded report queries as data grows.
3. Missing indexes for common filters/sorts.
4. Provider rate limits or network latency before raw compute capacity.

## Decisions
- Use managed Supabase at launch.
- Keep item list reads bounded and add pagination before the data set grows.
- Measure p50/p95/p99 latency and errors before upgrading infrastructure.
- Do not add Redis, microservices, sharding, or Kubernetes until measured results justify them.

## Verification status
The above figures are assumptions only. No live usage, query plan, load test, or monthly provider cost has been measured. Replace these assumptions with actual usage after launch.

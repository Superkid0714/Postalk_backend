# Guest session 503 investigation (2026-11-18)

## Confirmed evidence

- Public request: POST /api/guest-session, 2026-11-17 20:24:11.874 UTC (2026-11-18 05:24:11 KST), HTTP 503, duration 383 ms. Railway request ID: tVwRRIzHQM6ACdG0mrpb1w.
- Backend deployment: 21ff4a31-7f5a-45ae-9216-50ae1430823e, commit 108f8df7dbdc4af9a84b041c3b5a5328dba74092.
- Supabase API Gateway log: 20:24:11.522 UTC, POST /rest/v1/stores?on_conflict=guest_session_hash, HTTP 401, proxy_status=PostgREST; error=PGRST303. Supabase request ID: 01a1eb2e-7002-714f-a59c-1d9cfb946fd6.
- PGRST303 means JWT claims validation or parsing failed. The guest route mapped this upstream error to AUTH_UNAVAILABLE/503. It was not a frontend-only failure.
- The adjacent store POST succeeded with the same server API key identity. Supabase DNS lookups succeeded. No matching Christmas QA store was committed at the failed request time; the next test created it at 20:24:54.611 UTC.

## Remediation

- Send sb_secret_ credentials only through apikey; remove the SDK's matching Authorization Bearer fallback for this server client. Preserve legacy JWT keys and explicitly supplied user tokens. Keep authentication enabled; do not change keys, privileges, or RLS.
- The previous transient retry list omitted upstream 401/PGRST303. Include only that specific claims-validation error in the existing maximum three attempts. Other authentication/permission errors remain terminal.
- Retain unique guest hashes, bounded deadlines and privacy-safe diagnostics.

## Evidence limits

The response body from the original upstream failure was not captured. PGRST303 is confirmed; the exact rejected claim (expiration, not-before, audience, etc.) is not known. The duplicate Bearer header is a verified compatibility issue to remove, not proof of a specific Supabase internal defect. No claim is made that the dashboard's incident banner caused this request.

## References

- https://docs.postgrest.org/en/stable/references/errors.html#group-3-jwt
- https://supabase.com/docs/guides/getting-started/api-keys#known-limitations

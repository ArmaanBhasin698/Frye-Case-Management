# app/(dashboard)/communications

Firm-wide Communications route. `page.tsx` is a real, authorized
Calls-first aggregate view over the existing per-matter `Call` rows
(`lib/communications/queries.ts#getFirmWideCalls`) — not a new record or a
second Call model. Manual call logging (`lib/matters/actions.ts#createCall`)
is real too, usable from here, from a Matter's Calls tab, and from the
Matter Overview's "Log a Call" quick action.

No Vonage/telephony integration exists yet — every `Call` row is manually
logged or seeded. See `docs/ROADMAP.md`'s Phase 5/6 and
`docs/SECURITY.md`'s Authorization section (Communications) for the full
write-up, including the conservative unfiled-call visibility rule
(ADMIN/ATTORNEY only, since unfiled calls carry no assignment/ownership of
their own to scope by).

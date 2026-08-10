# app/(dashboard)/discovery

Firm-wide Discovery route. `page.tsx` is a real, authorized aggregate view
over the existing per-matter `DiscoveryFile`/`DiscoveryProduction` rows
(`lib/discovery/queries.ts#getFirmWideDiscoveryFiles`) — not a new
Discovery/Bates record or a second upload/download path. Registering a
file, running a comparison, and downloading a file's original/stamped
bytes all still happen on a matter's own Discovery tab
(`app/(dashboard)/matters/[matterId]/discovery`); every row here links
back there instead of duplicating that logic.

See `docs/ROADMAP.md`'s fifteenth-session milestone and
`docs/SECURITY.md`'s Authorization section for the full write-up.

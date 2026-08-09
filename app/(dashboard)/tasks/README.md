# app/(dashboard)/tasks

Firm-wide Tasks route. `page.tsx` is a real, authorized aggregate view over
the existing per-matter `Task` rows (`lib/tasks/queries.ts#getFirmWideTasks`)
— not a new Task record or a second CRUD path. See `docs/ROADMAP.md`'s
"Firm-wide Tasks & Calendar" milestone and `docs/SECURITY.md`'s
Authorization section for the full write-up.

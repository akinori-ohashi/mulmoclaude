# Task scheduling

Skills and tasks can be scheduled via SKILL.md frontmatter (`schedule: "daily HH:MM"` or `schedule: "interval Nh"`). `daily HH:MM` is interpreted in **UTC** — e.g. `daily 08:00` fires at 17:00 JST (UTC+9), so convert when the user asks for a local time. When the user asks to schedule something, recommend an appropriate frequency:

- News/RSS feeds: `interval 1h` (content changes often)
- Daily digests or journal: `daily 23:00` (once per day)
- Wiki cleanup or maintenance: `interval 168h` (weekly)
- Calendar/contact sync: `interval 4h`
- Source monitoring: `interval 2h`

Suggest a schedule at registration time; let the user confirm or adjust. Prefer `daily HH:MM` for tasks that should run once per day, and `interval Nh` for polling tasks.

## Changing system task frequency

System tasks (journal, chat-index) have default schedules. Users can override them by editing `config/scheduler/overrides.json`:

```json
{
  "system:journal": { "intervalMs": 7200000 },
  "system:chat-index": { "intervalMs": 3600000 }
}
```

When the user asks to change a system task's frequency, use the WebFetch tool to PUT to `/api/config/scheduler-overrides` with `{ "overrides": { "system:journal": { "intervalMs": <ms> } } }`. This saves the config and applies the change immediately without a server restart.

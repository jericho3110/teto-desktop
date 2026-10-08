# Reminder service architecture

```text
 HTTP request ─► handle(): Host check → token check → handler → Response(status, json)
                                                   │
                         POST /reminders ─► parseForm(readBody) ─► ReminderStore.add ─► save (tmp + atomic move)
                         GET  /reminders ─► ReminderStore.all
                         POST /due       ─► ReminderStore.takeDue(now) ─► removes + returns due ones
```

| Decision | Alternatives | Why | Cost |
| --- | --- | --- | --- |
| brain **polls** `/due` every 15 s | Java pushes to the brain; Java runs its own timers | the service stays passive and stateless towards the brain; restart-safe | up to 15 s late |
| "take" semantics (due reminders are removed when returned) | mark as fired | each reminder fires exactly once even if the brain restarts | a reminder taken by a crashing brain is lost |
| TSV file, rewritten each change | SQLite, JSON | readable, no dependencies, tiny data | O(n) rewrite per change (fine for dozens) |
| form in, JSON out | JSON both ways | JDK can decode forms but has no JSON parser | two formats |

## References

- JEP 444, Virtual threads: <https://openjdk.org/jeps/444>

# java/: the reminder service

| Component | What it is |
| --- | --- |
| [`reminders/`](reminders/) | stores reminders and hands them back when they're due. `/remind 10m stretch` in Teto's bar → Go brain → this service; the brain polls `/due` and Teto announces them |

**Why Java:** a long-running service with a built-in HTTP server and
virtual threads, using nothing but the JDK.

## Commands (in `java/reminders`, JDK 21+)

```powershell
javac -Xlint:all -Werror -d out src/teto/reminders/*.java
javac -Xlint:all -Werror -cp out -d out-test test/teto/reminders/*.java
java "-Djdk.httpclient.allowRestrictedHeaders=host" -cp "out;out-test" teto.reminders.ReminderTest   # 19 checks
$env:TETO_TOKEN = "devtoken"; java -cp out teto.reminders.ReminderServer 47801                       # run it
```

Each flag is explained in [docs/CONCEPTS.md](docs/CONCEPTS.md#15-compiling-and-running-by-hand-javac-java--xlint).
Reminders are saved to `~/.teto/reminders.tsv`.

## API

Every request needs `Authorization: Bearer <TETO_TOKEN>` and `Host: 127.0.0.1`.
See [../docs/PROTOCOL.md](../docs/PROTOCOL.md#brain--reminder-service).

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every Java concept used
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CHANGELOG.md](CHANGELOG.md)

## References

- JDK 25 documentation: <https://docs.oracle.com/en/java/javase/25/>

# Java concepts used in Teto

Every Java concept and principle in `java/reminders/`, the reminder
service. JDK only: no Maven, no Gradle, no libraries.

## Contents

1. [Packages, folders and the classpath](#1-packages-folders-and-the-classpath)
2. [Classes: final, static, constructors, fields](#2-classes-final-static-constructors-fields)
3. [Records](#3-records)
4. [Interfaces, lambdas and functional interfaces](#4-interfaces-lambdas-and-functional-interfaces)
5. [Switch expressions and `yield`](#5-switch-expressions-and-yield)
6. [Collections and streams](#6-collections-and-streams)
7. [Exceptions: checked, unchecked, custom](#7-exceptions-checked-unchecked-custom)
8. [try-with-resources](#8-try-with-resources)
9. [Concurrency: synchronized and virtual threads](#9-concurrency-synchronized-and-virtual-threads)
10. [Files: NIO, atomic writes, encodings](#10-files-nio-atomic-writes-encodings)
11. [Strings: StringBuilder, escaping, code points](#11-strings-stringbuilder-escaping-code-points)
12. [The built-in HTTP server and client](#12-the-built-in-http-server-and-client)
13. [Security code: constant-time compare, limits, Host check](#13-security-code-constant-time-compare-limits-host-check)
14. [Static imports and `var`](#14-static-imports-and-var)
15. [Compiling and running by hand: javac, java, -Xlint](#15-compiling-and-running-by-hand-javac-java--xlint)
16. [Testing without a framework](#16-testing-without-a-framework)
17. [Principles applied](#17-principles-applied)
18. [Exercises](#18-exercises)
19. [References](#references)

## 1. Packages, folders and the classpath

`package teto.reminders;` must match the folder `src/teto/reminders/`.
`javac -d out ...` writes `out/teto/reminders/ReminderStore.class`;
`java -cp out teto.reminders.ReminderServer` finds classes by searching
the **classpath** (`-cp`). On Windows the separator in `-cp "out;out-test"` is
`;` (it's `:` on Linux/macOS).

## 2. Classes: final, static, constructors, fields

- `public final class ReminderStore`: `final` = no subclasses (it isn't
  designed for inheritance; "design for inheritance or prohibit it").
- `private final Path file;`: assigned once, in the constructor.
- `static` members belong to the class, not an instance:
  `ReminderServer.start(...)`, `MAX_TEXT`, helper methods like `jsonString`.
- `public static final int MAX_TEXT = 500;`: a constant.

## 3. Records

```java
public record Reminder(String id, long at, String text) {}
```

A **record** (Java 16+) is an immutable data carrier: Java generates the
constructor, accessors `id()`, `at()`, `text()`, `equals`, `hashCode`
and `toString`. `Response(int status, String json)` in the server is a
record too. Use them for plain data; use classes for things with behavior.

## 4. Interfaces, lambdas and functional interfaces

```java
@FunctionalInterface
interface Handler { Response run() throws IOException; }
handle(ex, token, () -> new Response(200, ...));        // a lambda implementing Handler
server.createContext("/due", ex -> handle(...));          // HttpHandler as a lambda
items.removeIf(r -> { ... });                             // Predicate<Reminder>
Comparator.comparingLong(Reminder::at)                    // method reference
```

A **functional interface** has exactly one abstract method, so a lambda can
implement it. `@FunctionalInterface` makes the compiler check that.
We define our own `Handler` because the standard `Supplier` can't throw
the *checked* `IOException`.

## 5. Switch expressions and `yield`

```java
switch (ex.getRequestMethod()) {
    case "POST" -> { ...; yield new Response(201, ...); }
    case "GET" -> new Response(200, ...);
    default -> new Response(405, ...);
}
```

Arrow-switch (Java 14+) is an **expression** that produces a value; there's no
fall-through. In a block, `yield` gives the value. `unescape` uses one to map
escape letters to characters.

## 6. Collections and streams

- `List<Reminder> items = new ArrayList<>()`: the `<>` "diamond" infers the type.
- `List.copyOf(items)`: an **unmodifiable snapshot**, so callers can't change our list.
- `items.stream().map(r -> ...).toList()`: a stream pipeline (Java 16+ `toList()`).
- `Map<String, String> out = new HashMap<>()`: the parsed form.

## 7. Exceptions: checked, unchecked, custom

- **Checked** exceptions (`IOException`) must be declared (`throws`) or
  caught: the compiler forces you to think about I/O failure.
- **Unchecked** (`RuntimeException` subclasses like
  `IllegalArgumentException`, `NumberFormatException`) don't have to be declared.
- `Refused extends RuntimeException` carries an HTTP status; `handle()`
  maps exception types to responses: `Refused` → its status, bad input → 400,
  anything else → 500. One place for all error handling.
- **Gotcha (found by `-Xlint`):** every `Throwable` is `Serializable`, so a
  subclass should declare `serialVersionUID`.

## 8. try-with-resources

```java
try (OutputStream os = ex.getResponseBody()) { os.write(body); }
```

Anything `AutoCloseable` declared in `try (...)` is closed automatically,
even if an exception is thrown. The test uses it for `Files.list(dir)` too.

## 9. Concurrency: synchronized and virtual threads

- The HTTP server handles requests concurrently, so `ReminderStore`'s
  methods are `synchronized`: only one thread at a time per store
  (its intrinsic lock).
- `Executors.newVirtualThreadPerTaskExecutor()` (Java 21+, JEP 444): each
  request gets a **virtual thread**, a lightweight thread managed by the
  JVM (like a goroutine), so there's no thread-pool sizing to think about.

## 10. Files: NIO, atomic writes, encodings

- `java.nio.file`: `Path.of(...)`, `Files.readAllLines`, `Files.write`,
  `Files.createDirectories`, `Files.createTempDirectory` (tests).
- **Atomic replace**: write `reminders.tsv.tmp`, then
  `Files.move(tmp, file, REPLACE_EXISTING, ATOMIC_MOVE)`, so a crash
  mid-write leaves either the old file or the new one, never half of each.
- Always pass `UTF_8` (`StandardCharsets.UTF_8`); the platform default varies.

## 11. Strings: StringBuilder, escaping, code points

- `StringBuilder` for building JSON (strings are immutable; `+=` in a
  loop would copy every time).
- **Escaping**: tabs/newlines in reminder text would break the TSV format, so
  `escape`/`unescape` encode them; `jsonString` escapes quotes, backslashes and
  control characters (`\\u%04x`).
- `text.codePointCount(...)` counts **characters**, not UTF-16 units, so an
  emoji counts as 1 (matching Go's rune count).

## 12. The built-in HTTP server and client

- `com.sun.net.httpserver.HttpServer` ships with the JDK (module
  `jdk.httpserver`). `createContext(path, handler)`, `sendResponseHeaders`,
  `getResponseBody`. It's minimal but enough for a local service.
- Bound to `InetAddress.getLoopbackAddress()`, so nothing outside the PC can connect.
- Port `0` = "OS, pick a free port" (tests).
- Tests use `java.net.http.HttpClient` (Java 11+). **Gotcha:** it refuses to
  set the `Host` header unless started with
  `-Djdk.httpclient.allowRestrictedHeaders=host`.

## 13. Security code: constant-time compare, limits, Host check

| Defense | Code |
| --- | --- |
| Token required on every request | `checkHostAndToken`, using `MessageDigest.isEqual` (constant time) |
| DNS-rebinding defense | Host must be `127.0.0.1` or `localhost` |
| No empty token | `main` exits; `start` throws |
| Bounded body | `readNBytes(MAX_BODY + 1)` → 413 if larger |
| Bounded text | `MAX_TEXT = 500` → 400 |

**Why the token matters here:** a form POST is a "simple" cross-origin
request that browsers send *without* asking the server first. Without the
token, any web page could add reminders that Teto then announces.

## 14. Static imports and `var`

- `import static java.nio.charset.StandardCharsets.UTF_8;` lets you write `UTF_8`.
- `var http = HttpClient.newHttpClient();` (Java 10+): the compiler infers
  the type. Use it when the right side makes the type obvious.

## 15. Compiling and running by hand: javac, java, -Xlint

| Command | Meaning |
| --- | --- |
| `javac -Xlint:all -Werror -d out src/teto/reminders/*.java` | compile; all lint warnings on, warnings are errors; `-d out` = output folder |
| `javac -Xlint:all -Werror -cp out -d out-test test/teto/reminders/*.java` | compile tests against the main classes |
| `java -cp "out;out-test" teto.reminders.ReminderTest` | run the tests' `main` |
| `java -cp out teto.reminders.ReminderServer 47801` | run the service (needs `TETO_TOKEN`) |

A build tool (Maven/Gradle) becomes worth it once you need dependencies
(e.g. JUnit) or many modules.

## 16. Testing without a framework

`ReminderTest.main` runs checks and throws `AssertionError` on the first
failure (non-zero exit). It starts a **real server on a random port** and
sends real HTTP requests, including a forged no-token form POST. JUnit
would add nicer reports, parameterized tests and IDE integration.

## 17. Principles applied

| Principle | Where |
| --- | --- |
| **Separation of concerns** | `ReminderStore` (data, no HTTP) vs `ReminderServer` (HTTP) |
| **Immutability** | records, `List.copyOf` |
| **Centralized error handling** | `handle()` |
| **Defense in depth** | Host + token + limits |
| **Atomic persistence** | temp file + atomic move |

## 18. Exercises

1. Add `DELETE /reminders/{id}`. How do you read the id from the path?
2. Replace the TSV file with JSON lines. What escaping do you still need?
3. Port the tests to JUnit 5 with Maven. What does the `pom.xml` need?
4. Self-check: why does `takeDue` call `save()` only when something was removed?

## References

### Official

- Java Language Specification, records ✔: <https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.10>
- JEP 395, Records: <https://openjdk.org/jeps/395>
- JEP 361, Switch expressions: <https://openjdk.org/jeps/361>
- JEP 444, Virtual threads: <https://openjdk.org/jeps/444>
- `com.sun.net.httpserver`: <https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/package-summary.html>
- `java.net.http.HttpClient`: <https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html>
- `Files.move` / `ATOMIC_MOVE`: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html>
- `MessageDigest.isEqual`: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/MessageDigest.html>
- `javac` options (`-Xlint`): <https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html>

### Other

- Joshua Bloch, *Effective Java* (3rd ed.), items 17 (minimize mutability) and 19 (design for inheritance or prohibit it)
- Baeldung, try-with-resources: <https://www.baeldung.com/java-try-with-resources>

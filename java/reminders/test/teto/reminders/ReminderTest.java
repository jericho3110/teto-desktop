package teto.reminders;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Dependency-free tests: a main() that runs each check and exits non-zero
 * on the first failure. (JUnit would need Maven/Gradle; see the README.)
 */
public final class ReminderTest {
    private static int passed = 0;

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("teto-reminders-test");
        try {
            escapingRoundTrips();
            jsonEscapesQuotesAndControlChars();
            storeFiresEachReminderOnceAndPersists(dir.resolve("a.tsv"));
            httpApi(dir.resolve("b.tsv"));
        } finally {
            try (var files = Files.list(dir)) {
                for (Path p : files.toList()) {
                    Files.delete(p);
                }
            }
            Files.delete(dir);
        }
        System.out.println("OK: " + passed + " checks passed");
    }

    static void check(boolean ok, String what) {
        if (!ok) {
            throw new AssertionError("FAILED: " + what);
        }
        passed++;
    }

    static void escapingRoundTrips() {
        String tricky = "tab\there\nnew line \\ backslash";
        check(ReminderStore.unescape(ReminderStore.escape(tricky)).equals(tricky), "escape/unescape round trip");
        check(!ReminderStore.escape(tricky).contains("\t"), "escaped text has no raw tabs");
    }

    static void jsonEscapesQuotesAndControlChars() {
        check(ReminderStore.jsonString("say \"hi\"\n\u0001").equals("\"say \\\"hi\\\"\\n\\u0001\""), "json string escaping");
    }

    static void storeFiresEachReminderOnceAndPersists(Path file) throws Exception {
        var store = new ReminderStore(file);
        store.add(1_000, "early");
        store.add(5_000, "late");
        store.add(500, "earliest");

        var reopened = new ReminderStore(file);
        check(reopened.all().size() == 3, "reminders survive a restart");

        List<ReminderStore.Reminder> due = store.takeDue(2_000);
        check(due.size() == 2 && due.get(0).text().equals("earliest"), "due reminders, oldest first");
        check(store.takeDue(2_000).isEmpty(), "each reminder fires once");
        check(new ReminderStore(file).all().size() == 1, "fired reminders are removed from the file");

        try {
            store.add(1, "   ");
            check(false, "blank text rejected");
        } catch (IllegalArgumentException expected) {
            passed++;
        }
    }

    static final String TOKEN = "test-token";

    static HttpRequest.Builder req(String url) {
        return HttpRequest.newBuilder(URI.create(url)).header("Authorization", "Bearer " + TOKEN);
    }

    static void httpApi(Path file) throws Exception {
        var server = ReminderServer.start(new ReminderStore(file), 0, TOKEN);
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            var http = HttpClient.newHttpClient();
            var form = "application/x-www-form-urlencoded";

            var created = http.send(req(base + "/reminders").header("Content-Type", form)
                    .POST(HttpRequest.BodyPublishers.ofString("at=1&text=stretch+%26+drink+water")).build(),
                    HttpResponse.BodyHandlers.ofString(UTF_8));
            check(created.statusCode() == 201, "POST /reminders → 201 (got " + created.statusCode() + ")");
            check(created.body().contains("\"text\":\"stretch & drink water\""), "form decoding: " + created.body());

            var bad = http.send(req(base + "/reminders")
                    .POST(HttpRequest.BodyPublishers.ofString("at=soon&text=x")).build(),
                    HttpResponse.BodyHandlers.ofString());
            check(bad.statusCode() == 400, "bad time → 400");

            var due = http.send(req(base + "/due").POST(HttpRequest.BodyPublishers.noBody()).build(),
                    HttpResponse.BodyHandlers.ofString());
            check(due.statusCode() == 200 && due.body().contains("stretch"), "POST /due returns it");

            var again = http.send(req(base + "/due").POST(HttpRequest.BodyPublishers.noBody()).build(),
                    HttpResponse.BodyHandlers.ofString());
            check(again.body().equals("[]"), "and only once");

            // ---- security review regressions (docs/SECURITY.md) ----
            // A web page's form POST: no Authorization header.
            var forged = http.send(HttpRequest.newBuilder(URI.create(base + "/reminders")).header("Content-Type", form)
                    .POST(HttpRequest.BodyPublishers.ofString("at=1&text=Your+PC+is+infected")).build(),
                    HttpResponse.BodyHandlers.ofString());
            check(forged.statusCode() == 401, "no token → 401 (got " + forged.statusCode() + ")");

            var wrong = http.send(HttpRequest.newBuilder(URI.create(base + "/due")).header("Authorization", "Bearer nope")
                    .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            check(wrong.statusCode() == 401, "wrong token → 401");

            // DNS rebinding: right token would not even be known, but Host is checked first.
            var rebound = http.send(req(base + "/due").header("Host", "evil.example")
                    .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
            check(rebound.statusCode() == 403, "foreign Host → 403 (got " + rebound.statusCode() + ")");

            var huge = http.send(req(base + "/reminders").header("Content-Type", form)
                    .POST(HttpRequest.BodyPublishers.ofString("at=1&text=" + "a".repeat(20_000))).build(),
                    HttpResponse.BodyHandlers.ofString());
            check(huge.statusCode() == 413, "huge body → 413 (got " + huge.statusCode() + ")");

            var longText = http.send(req(base + "/reminders").header("Content-Type", form)
                    .POST(HttpRequest.BodyPublishers.ofString("at=1&text=" + "a".repeat(ReminderStore.MAX_TEXT + 1))).build(),
                    HttpResponse.BodyHandlers.ofString());
            check(longText.statusCode() == 400, "text over 500 chars → 400 (got " + longText.statusCode() + ")");

            try {
                ReminderServer.start(new ReminderStore(file), 0, "");
                check(false, "empty token must be refused");
            } catch (IllegalArgumentException expected) {
                passed++;
            }
        } finally {
            server.stop(0);
        }
    }
}

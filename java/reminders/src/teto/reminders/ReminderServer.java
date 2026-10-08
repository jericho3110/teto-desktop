package teto.reminders;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * Teto's reminder service. HTTP on 127.0.0.1 only, and every request
 * must carry {@code Authorization: Bearer <TETO_TOKEN>}: without it, any
 * web page could submit a form to 127.0.0.1 and make Teto announce
 * whatever it likes (see docs/SECURITY.md).
 *
 * <pre>
 *   POST /reminders   form: at=&lt;unix ms&gt;&amp;text=...   → 201 {"id":..,"at":..,"text":..}
 *   GET  /reminders                                 → 200 [ ... ]
 *   POST /due                                       → 200 [ due reminders, removed ]
 * </pre>
 *
 * Run: {@code java -cp out teto.reminders.ReminderServer [port] [file]}
 * with the environment variable TETO_TOKEN set.
 */
public final class ReminderServer {

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 47801;
        Path file = args.length > 1
                ? Path.of(args[1])
                : Path.of(System.getProperty("user.home"), ".teto", "reminders.tsv");
        String token = System.getenv("TETO_TOKEN");
        if (token == null || token.isBlank()) {
            System.err.println("TETO_TOKEN is not set; refusing to start an unauthenticated service.");
            System.exit(2);
        }
        HttpServer server = start(new ReminderStore(file), port, token);
        System.out.println("reminders listening on http://127.0.0.1:" + server.getAddress().getPort() + " (file " + file + ")");
    }

    /** Largest request body we accept; a reminder is a few hundred bytes. */
    static final int MAX_BODY = 8 * 1024;

    /** Port 0 = let the OS pick a free port (used by the tests). */
    public static HttpServer start(ReminderStore store, int port, String token) throws IOException {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token must not be empty");
        }
        // Loopback only: nothing outside this PC can reach the service.
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);

        server.createContext("/reminders", ex -> handle(ex, token, () -> switch (ex.getRequestMethod()) {
            case "POST" -> {
                Map<String, String> form = parseForm(readBody(ex));
                long at = Long.parseLong(form.getOrDefault("at", "x"));
                var r = store.add(at, form.get("text"));
                yield new Response(201, ReminderStore.toJson(r));
            }
            case "GET" -> new Response(200, ReminderStore.toJson(store.all()));
            default -> new Response(405, "{\"error\":\"method not allowed\"}");
        }));

        server.createContext("/due", ex -> handle(ex, token, () -> ex.getRequestMethod().equals("POST")
                ? new Response(200, ReminderStore.toJson(store.takeDue(System.currentTimeMillis())))
                : new Response(405, "{\"error\":\"method not allowed\"}")));

        // Virtual threads (Java 21+): one cheap thread per request, no pool sizing.
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        return server;
    }

    record Response(int status, String json) {}

    @FunctionalInterface
    interface Handler {
        Response run() throws IOException;
    }

    /** Thrown for requests we refuse; becomes the given status code. */
    static final class Refused extends RuntimeException {
        // Every Throwable is Serializable; -Xlint:serial asks subclasses to pin a version id.
        private static final long serialVersionUID = 1L;
        final int status;

        Refused(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    /** Shared checks + error handling: Host and token first, bad input → 400, anything else → 500. */
    private static void handle(HttpExchange ex, String token, Handler h) throws IOException {
        Response r;
        try {
            checkHostAndToken(ex, token);
            r = h.run();
        } catch (Refused e) {
            r = new Response(e.status, "{\"error\":" + ReminderStore.jsonString(e.getMessage()) + "}");
        } catch (IllegalArgumentException e) { // includes NumberFormatException
            r = new Response(400, "{\"error\":" + ReminderStore.jsonString(String.valueOf(e.getMessage())) + "}");
        } catch (Exception e) {
            r = new Response(500, "{\"error\":" + ReminderStore.jsonString(e.toString()) + "}");
        }
        byte[] body = r.json().getBytes(UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(r.status(), body.length);
        try (OutputStream os = ex.getResponseBody()) { // try-with-resources closes it for us
            os.write(body);
        }
    }

    /**
     * DNS-rebinding defense (Host must be localhost) plus the shared token,
     * compared in constant time with MessageDigest.isEqual.
     */
    static void checkHostAndToken(HttpExchange ex, String token) {
        String host = String.valueOf(ex.getRequestHeaders().getFirst("Host"));
        int colon = host.lastIndexOf(':');
        String name = colon >= 0 ? host.substring(0, colon) : host;
        if (!name.equals("127.0.0.1") && !name.equals("localhost")) {
            throw new Refused(403, "forbidden host");
        }
        String auth = String.valueOf(ex.getRequestHeaders().getFirst("Authorization"));
        byte[] expected = ("Bearer " + token).getBytes(UTF_8);
        if (!MessageDigest.isEqual(auth.getBytes(UTF_8), expected)) {
            throw new Refused(401, "bad token");
        }
    }

    /** Reads at most MAX_BODY bytes; a bigger body is refused instead of filling memory. */
    static String readBody(HttpExchange ex) throws IOException {
        byte[] body = ex.getRequestBody().readNBytes(MAX_BODY + 1);
        if (body.length > MAX_BODY) {
            throw new Refused(413, "request too large");
        }
        return new String(body, UTF_8);
    }

    /** a=1&b=hello+world → {a=1, b=hello world} */
    static Map<String, String> parseForm(String body) {
        Map<String, String> out = new HashMap<>();
        for (String pair : body.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            String key = eq < 0 ? pair : pair.substring(0, eq);
            String value = eq < 0 ? "" : pair.substring(eq + 1);
            out.put(URLDecoder.decode(key, UTF_8), URLDecoder.decode(value, UTF_8));
        }
        return out;
    }
}

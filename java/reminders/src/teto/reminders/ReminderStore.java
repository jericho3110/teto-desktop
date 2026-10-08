package teto.reminders;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * The reminder list: plain logic, no HTTP, so it is easy to test.
 *
 * <p>Saved as a tab-separated file (id, time, text), one reminder per line,
 * rewritten after every change. Methods are {@code synchronized}: the HTTP
 * server handles requests on many threads at once.
 */
public final class ReminderStore {

    /** A record is an immutable data class; Java generates the constructor, getters, equals and toString. */
    public record Reminder(String id, long at, String text) {}

    /** Same limit as the Go brain (MaxReminderText): it ends up in a bubble and a toast. */
    public static final int MAX_TEXT = 500;

    private final Path file;
    private final List<Reminder> items = new ArrayList<>();

    public ReminderStore(Path file) throws IOException {
        this.file = file;
        if (Files.exists(file)) {
            for (String line : Files.readAllLines(file, UTF_8)) {
                String[] parts = line.split("\t", 3);
                if (parts.length == 3) {
                    items.add(new Reminder(parts[0], Long.parseLong(parts[1]), unescape(parts[2])));
                }
            }
        }
    }

    public synchronized Reminder add(long atMillis, String text) throws IOException {
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("reminder text is empty");
        }
        if (text.codePointCount(0, text.length()) > MAX_TEXT) {
            throw new IllegalArgumentException("reminder text is longer than " + MAX_TEXT + " characters");
        }
        Reminder r = new Reminder(UUID.randomUUID().toString(), atMillis, text.strip());
        items.add(r);
        save();
        return r;
    }

    /** Removes and returns every reminder that is due, oldest first. Each fires exactly once. */
    public synchronized List<Reminder> takeDue(long nowMillis) throws IOException {
        List<Reminder> due = new ArrayList<>();
        items.removeIf(r -> {
            if (r.at() <= nowMillis) {
                due.add(r);
                return true;
            }
            return false;
        });
        if (!due.isEmpty()) {
            save();
        }
        due.sort(Comparator.comparingLong(Reminder::at));
        return due;
    }

    public synchronized List<Reminder> all() {
        return List.copyOf(items);
    }

    /** Write to a temp file, then move it over the real one, so a crash mid-write can't corrupt it. */
    private void save() throws IOException {
        Path dir = file.toAbsolutePath().getParent();
        Files.createDirectories(dir);
        Path tmp = dir.resolve(file.getFileName() + ".tmp");
        List<String> lines = items.stream()
                .map(r -> r.id() + "\t" + r.at() + "\t" + escape(r.text()))
                .toList();
        Files.write(tmp, lines, UTF_8);
        Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    // Tabs and newlines would break the line format, so they are escaped.
    static String escape(String s) {
        return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
    }

    static String unescape(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                out.append(switch (n) {
                    case 't' -> '\t';
                    case 'n' -> '\n';
                    case 'r' -> '\r';
                    default -> n;
                });
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    /** The JDK has no JSON library, but writing JSON is easy: escape strings and join. */
    static String toJson(List<Reminder> list) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(toJson(list.get(i)));
        }
        return sb.append(']').toString();
    }

    static String toJson(Reminder r) {
        return "{\"id\":" + jsonString(r.id()) + ",\"at\":" + r.at() + ",\"text\":" + jsonString(r.text()) + "}";
    }

    static String jsonString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.append('"').toString();
    }
}

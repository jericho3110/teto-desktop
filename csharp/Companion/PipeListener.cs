using System.IO.Pipes;

namespace Teto.Companion;

/// <summary>
/// Listens on \\.\pipe\teto-companion. The Go brain connects, writes one
/// JSON line, and disconnects; each line becomes a <see cref="Command"/>.
/// </summary>
public sealed class PipeListener : IDisposable
{
    public const string DefaultName = "teto-companion";

    private readonly string _name;
    private readonly Action<Command> _onCommand;
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;

    public PipeListener(string name, Action<Command> onCommand)
    {
        _name = name;
        _onCommand = onCommand;
    }

    public void Start() => _loop = Task.Run(() => RunAsync(_stop.Token));

    private async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                // CurrentUserOnly: only clients running as the same user (and
                // elevation level) can connect, so other accounts can't send commands.
                // FirstPipeInstance: fail instead of joining a pipe someone else
                // created first under our name ("pipe squatting").
                await using var pipe = new NamedPipeServerStream(
                    _name, PipeDirection.In, maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly | PipeOptions.FirstPipeInstance);
                await pipe.WaitForConnectionAsync(ct);
                using var reader = new StreamReader(pipe);
                // Bounded read: one line, and Parse rejects anything over 16 KB.
                var line = await reader.ReadLineAsync(ct);
                if (Commands.Parse(line) is { } cmd) // pattern matching: non-null → bind to `cmd`
                {
                    _onCommand(cmd);
                }
            }
            catch (OperationCanceledException)
            {
                return; // Dispose() was called
            }
            catch (IOException)
            {
                // Client disconnected early, or the pipe name is taken by
                // another instance; wait a moment instead of spinning.
                try
                {
                    await Task.Delay(500, ct);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _loop?.Wait(TimeSpan.FromSeconds(2)); } catch (AggregateException) { }
        _stop.Dispose();
    }
}

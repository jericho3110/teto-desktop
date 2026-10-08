using System.IO.Pipes;
using Teto.Companion;

namespace Teto.Companion.Tests;

public class CommandsTests
{
    [Fact]
    public void ParsesSpeakAndNotify()
    {
        Assert.Equal(new Command(CommandKind.Speak, "hi", ""), Commands.Parse("""{"cmd":"speak","text":"hi"}"""));
        Assert.Equal(new Command(CommandKind.Notify, "stretch", "Teto reminder"),
            Commands.Parse("""{"cmd":"notify","title":"Teto reminder","text":"stretch"}"""));
    }

    [Theory] // one test, many inputs: every one of these must be rejected without throwing
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[1,2,3]")]
    [InlineData("""{"cmd":"format_c_drive","text":"x"}""")]
    [InlineData("""{"cmd":"speak"}""")]
    [InlineData("""{"cmd":"speak","text":"   "}""")]
    [InlineData("""{"cmd":"speak","text":42}""")]
    public void RejectsBadInput(string? line) => Assert.Null(Commands.Parse(line));

    [Fact]
    public void ClipsLongText()
    {
        var cmd = Commands.Parse($$"""{"cmd":"notify","title":"{{new string('t', 500)}}","text":"{{new string('a', 5000)}}"}""");
        Assert.NotNull(cmd);
        Assert.Equal(Commands.MaxText, cmd.Text.Length);
        Assert.Equal(Commands.MaxTitle, cmd.Title.Length);
    }

    [Fact]
    public void RejectsHugeLines() =>
        Assert.Null(Commands.Parse($$"""{"cmd":"speak","text":"{{new string('a', 20_000)}}"}"""));

    [Fact]
    public void SpeechSkipsCodeAndUrls()
    {
        var spoken = Commands.ForSpeech("Done! **All** tests pass:\n```\nnpm test\n```\nSee https://example.com/x for details.");
        Assert.Equal("Done! All tests pass: (code) See (link) for details.", spoken);
    }
}

public class PipeListenerTests
{
    [Fact]
    public async Task DeliversOneCommandPerConnection()
    {
        var name = "teto-test-" + Guid.NewGuid().ToString("N"); // unique: tests never touch the real pipe
        var got = new TaskCompletionSource<Command>();
        using var listener = new PipeListener(name, c => got.TrySetResult(c));
        listener.Start();

        await using (var client = new NamedPipeClientStream(".", name, PipeDirection.Out))
        {
            await client.ConnectAsync(5000);
            await using var w = new StreamWriter(client);
            await w.WriteLineAsync("""{"cmd":"speak","text":"hello from the test"}""");
        }

        var cmd = await got.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("hello from the test", cmd.Text);
    }
}

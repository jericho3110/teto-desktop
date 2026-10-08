using System.Speech.Synthesis;

namespace Teto.Companion;

/// <summary>
/// The tray icon, its menu, notifications and the voice. An
/// ApplicationContext is a WinForms app with no main window.
/// </summary>
public sealed class TrayApp : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly SpeechSynthesizer _voice = new();
    private readonly PipeListener _pipe;
    private readonly SynchronizationContext _ui;
    private readonly ToolStripMenuItem _voiceItem;
    private bool _speak = true;

    public TrayApp(string pipeName)
    {
        // Commands arrive on a background thread; UI objects (NotifyIcon)
        // must only be touched on the UI thread, so we Post() back to it.
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

        _voiceItem = new ToolStripMenuItem("Voice", null, (_, _) => ToggleVoice()) { Checked = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("Teto companion") { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_voiceItem);
        menu.Items.Add(new ToolStripMenuItem("Quit companion", null, (_, _) => ExitThread()));

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Information, // placeholder until a Teto .ico exists
            Text = "Teto companion",
            ContextMenuStrip = menu,
            Visible = true,
        };

        PickVoice();
        _pipe = new PipeListener(pipeName, cmd => _ui.Post(_ => Handle(cmd), null));
        _pipe.Start();
    }

    /// <summary>Prefer a female voice if one is installed (Teto is a voice-synth idol).</summary>
    private void PickVoice()
    {
        try
        {
            _voice.SelectVoiceByHints(VoiceGender.Female);
            _voice.Rate = 1; // -10..10
        }
        catch (InvalidOperationException) { /* keep the default voice */ }
    }

    private void ToggleVoice()
    {
        _speak = !_speak;
        _voiceItem.Checked = _speak;
        if (!_speak) _voice.SpeakAsyncCancelAll();
    }

    private void Handle(Command cmd)
    {
        switch (cmd.Kind)
        {
            case CommandKind.Speak when _speak: // `when` adds a condition to a case
                _voice.SpeakAsyncCancelAll(); // a new reply interrupts the old one
                _voice.SpeakAsync(Commands.ForSpeech(cmd.Text));
                break;
            case CommandKind.Notify:
                // On Windows 10/11 a balloon tip is shown as a toast notification.
                _tray.ShowBalloonTip(8000, cmd.Title, cmd.Text, ToolTipIcon.Info);
                break;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pipe.Dispose();
            _voice.Dispose();
            _tray.Visible = false; // otherwise a "ghost" icon stays until you hover it
            _tray.Dispose();
        }
        base.Dispose(disposing);
    }
}

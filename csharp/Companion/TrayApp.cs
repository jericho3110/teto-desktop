using System.Media;
using System.Speech.Synthesis;
using Teto.Companion.Voice;

namespace Teto.Companion;

/// <summary>Which voice reads Teto's replies.</summary>
public enum VoiceMode { Teto, Windows, Off }

/// <summary>
/// The tray icon, its menu, notifications and the voices. An
/// ApplicationContext is a WinForms app with no main window.
/// </summary>
public sealed class TrayApp : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly SpeechSynthesizer _windowsVoice = new();
    private readonly PipeListener _pipe;
    private readonly SynchronizationContext _ui;
    private readonly Dictionary<VoiceMode, ToolStripMenuItem> _modeItems = [];
    private readonly ToolStripMenuItem _tetoItem;
    private TetoVoice? _teto;           // null until the voicebank has loaded (or if it isn't installed)
    private SoundPlayer? _player;       // the clip currently playing
    private VoiceMode _mode = VoiceMode.Teto;

    public TrayApp(string pipeName)
    {
        // Commands arrive on a background thread; UI objects (NotifyIcon)
        // must only be touched on the UI thread, so we Post() back to it.
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

        var voiceMenu = new ToolStripMenuItem("Voice");
        _tetoItem = AddMode(voiceMenu, VoiceMode.Teto, "Teto (loading voicebank...)");
        AddMode(voiceMenu, VoiceMode.Windows, "Windows voice");
        AddMode(voiceMenu, VoiceMode.Off, "Off");

        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("Teto's voice & notifications") { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(voiceMenu);
        // Only this helper closes; Teto herself is quit from HER tray icon or right-click menu.
        menu.Items.Add(new ToolStripMenuItem("Turn off voice && notifications (Teto keeps running)", null, (_, _) => ExitThread()));

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Information, // placeholder until a Teto .ico exists
            Text = "Teto: voice & notifications",
            ContextMenuStrip = menu,
            Visible = true,
        };

        PickWindowsVoice();
        SetMode(VoiceMode.Teto);
        LoadTetoVoiceInBackground();
        _pipe = new PipeListener(pipeName, cmd => _ui.Post(_ => Handle(cmd), null));
        _pipe.Start();
    }

    private ToolStripMenuItem AddMode(ToolStripMenuItem parent, VoiceMode mode, string label)
    {
        var item = new ToolStripMenuItem(label, null, (_, _) => SetMode(mode));
        parent.DropDownItems.Add(item);
        _modeItems[mode] = item;
        return item;
    }

    private void SetMode(VoiceMode mode)
    {
        _mode = mode;
        foreach (var (m, item) in _modeItems)
        {
            item.Checked = m == mode; // radio-button behavior
        }
        StopSpeaking();
    }

    /// <summary>
    /// Reading ~150 WAV files takes a moment, so it happens on the thread
    /// pool; the result is handed back to the UI thread with Post.
    /// </summary>
    private void LoadTetoVoiceInBackground() => Task.Run(() =>
    {
        TetoVoice? voice = null;
        try
        {
            voice = TetoVoice.Load(TetoVoice.DefaultFolder);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // unreadable voicebank folder: fall back below
        }
        _ui.Post(_ =>
        {
            _teto = voice;
            if (voice is null)
            {
                _tetoItem.Text = "Teto (voicebank not installed)";
                _tetoItem.Enabled = false;
                if (_mode == VoiceMode.Teto)
                {
                    SetMode(VoiceMode.Windows);
                }
            }
            else
            {
                _tetoItem.Text = $"Teto ({voice.ClipCount} syllables)";
            }
        }, null);
    });

    /// <summary>Prefer a female voice if one is installed.</summary>
    private void PickWindowsVoice()
    {
        try
        {
            _windowsVoice.SelectVoiceByHints(VoiceGender.Female);
            _windowsVoice.Rate = 1; // -10..10
        }
        catch (InvalidOperationException) { /* keep the default voice */ }
    }

    private void StopSpeaking()
    {
        _windowsVoice.SpeakAsyncCancelAll();
        _player?.Stop();
    }

    private void Handle(Command cmd)
    {
        switch (cmd.Kind)
        {
            case CommandKind.Speak when _mode == VoiceMode.Teto && _teto is not null:
                StopSpeaking(); // a new reply interrupts the old one
                var wav = Wav.Write(_teto.Render(cmd.Text), _teto.SampleRate);
                _player?.Dispose();
                _player = new SoundPlayer(new MemoryStream(wav));
                _player.Play(); // asynchronous: returns immediately
                break;
            case CommandKind.Speak when _mode == VoiceMode.Windows:
                StopSpeaking();
                _windowsVoice.SpeakAsync(Commands.ForSpeech(cmd.Text));
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
            _windowsVoice.Dispose();
            _player?.Dispose();
            _tray.Visible = false; // otherwise a "ghost" icon stays until you hover it
            _tray.Dispose();
        }
        base.Dispose(disposing);
    }
}

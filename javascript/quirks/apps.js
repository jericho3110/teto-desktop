// Teto notices which program you switch to (the C module reads it; only
// the program's file name ever reaches the UI, never window titles).
// She comments at most once every 20 minutes so she isn't annoying.

const LINES = {
  "code.exe": ["Ooh, VS Code! Let's write something cool~", "Coding time! Need a hand?"],
  "windowsterminal.exe": ["The terminal! Very hacker of you."],
  "chrome.exe": ["Browsing again? Don't forget your tabs."],
  "msedge.exe": ["Edge, huh. Bold choice."],
  "firefox.exe": ["A Firefox fan! Respect."],
  "spotify.exe": ["Music! ...is it one of MY songs?"],
  "discord.exe": ["Say hi to everyone for me!"],
  "explorer.exe": null, // switching folders is too common to comment on
};

export default function apps(teto) {
  let last = 0;
  teto.on("app", (name) => {
    const lines = LINES[String(name).toLowerCase()];
    const now = Date.now();
    if (!lines || teto.isBusy() || now - last < 20 * 60_000) return;
    last = now;
    teto.say(lines[Math.floor(Math.random() * lines.length)], 4500);
    teto.emote("happy", 0.4);
  });
}

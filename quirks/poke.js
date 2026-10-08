// Poke her a few times quickly and she gets annoyed.

const LINES = [
  "Hey! I'm 31 years old, show some respect!",
  "Do you poke all your assistants like this?",
  "My drills are NOT buttons!",
];

export default function poke(teto) {
  let times = [];
  teto.on("poke", () => {
    const now = Date.now();
    times = times.filter((t) => now - t < 2000);
    times.push(now);
    if (times.length >= 3 && !teto.isBusy()) {
      times = [];
      teto.say(LINES[Math.floor(Math.random() * LINES.length)], 4000);
      teto.emote("smug", 0.7);
      teto.bounce(3);
    }
  });
}

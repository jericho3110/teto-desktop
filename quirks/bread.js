// Teto loves French bread. When a reply mentions bread, she gets excited;
// and once in a long while, when idle, she daydreams about it.

export default function bread(teto) {
  teto.on("reply", (text) => {
    if (/\b(baguette|bread|croissant)s?\b/i.test(String(text))) {
      teto.emote("excited", 0.9);
    }
  });

  teto.on("tick", () => {
    // About once every ~3 hours of idle minutes.
    if (!teto.isBusy() && Math.random() < 1 / 180) {
      teto.say("...I could really go for a baguette right now.", 5000);
      teto.emote("happy", 0.4);
    }
  });
}

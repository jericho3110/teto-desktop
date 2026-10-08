// Says hello on start, depending on the time of day, and nags you
// to sleep if you're still at the computer very late.
// A quirk is a default-exported function that receives the quirk API
// (see app/src/quirks.ts for everything it offers).

export default function greetings(teto) {
  teto.on("start", () => {
    const h = new Date().getHours();
    const hello =
      h < 5 ? "Still up?! ...fine, I'll keep you company." :
      h < 12 ? "Good morning! Teto, reporting for duty~" :
      h < 18 ? "Afternoon! What are we building today?" :
      "Evening! Click me or press Ctrl+Alt+Space to give me a task.";
    teto.say(hello, 6000);
    teto.wave();
    teto.emote("happy", 0.6);
  });

  let lastNag = 0;
  teto.on("tick", (now) => {
    const h = now.getHours();
    if (h >= 1 && h < 5 && now.getTime() - lastNag > 45 * 60_000 && !teto.isBusy()) {
      lastNag = now.getTime();
      teto.say("It's past " + h + " AM. Even chimeras need sleep, you know.", 8000);
      teto.emote("worried", 0.5);
    }
  });
}

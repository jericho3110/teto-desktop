// Reacts to falling asleep (no keyboard/mouse input for 5 minutes,
// detected by the C module) and to being woken up.

export default function sleepy(teto) {
  teto.on("wake", () => {
    teto.say("Wha-! I wasn't sleeping! I was... buffering.", 4000);
    teto.emote("smug", 0.6);
    teto.bounce(2);
  });
}

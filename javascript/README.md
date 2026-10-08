# javascript/: quirks and the UI probe

| Component | What it is |
| --- | --- |
| [`quirks/`](quirks/) | Teto's personality: small plugins loaded at runtime (`greetings`, `poke`, `sleepy`, `bread`) |
| [`tools/ui_probe.mjs`](tools/ui_probe.mjs) | opens the UI in headless Edge via the DevTools Protocol: prints console errors, runs JS steps, saves a screenshot |

**Why JavaScript:** quirks need no build step; drop a `.js` file in
`quirks/` and restart the UI. The probe needs nothing but Node 22+.

## Writing a quirk

```js
// javascript/quirks/hello.js
export default function hello(teto) {
  teto.on("poke", () => teto.say("Hi!"));
}
```

API: `on(event, fn)` with events `start poke reply mood sleep wake tick`;
`say(text, ms?)`, `emote(emotion, intensity?)`, `bounce(strength?)`,
`wave()`, `isBusy()`. Full types in [`typescript/ui/src/quirks.ts`](../typescript/ui/src/quirks.ts).

⚠️ A quirk is **code that runs inside Teto's window**. Only add quirks you
wrote or have read.

## Running the probe

```powershell
cd typescript/ui; npm run dev                  # in one terminal (plus a dev brain)
node javascript/tools/ui_probe.mjs "http://localhost:1420/?token=devtoken" shot.png [steps.js]
```

`steps.js` (optional) runs in the page after load; in dev mode `window.teto`
exposes `animator`, `bubble`, `bar`, `quirks` to drive states.

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every JavaScript concept used
- [CHANGELOG.md](CHANGELOG.md)

## References

- MDN JavaScript guide: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide>

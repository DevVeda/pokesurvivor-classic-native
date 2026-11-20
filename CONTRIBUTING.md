# Contributing

Thanks for wanting to help. This is a fan project: free and non-profit.

## Before you start

- Work happens on the **`dev`** branch: one codebase for every platform. There are no per-platform branches.
- Anything that differs between platforms goes in `native/platform/<name>.c` (C) or asks `ps.CAN`
  (JS, in `native/shim/browser.js` and `native/shim/web.js`). Never by checking the platform's name.
- The game is the sources in `js/<area>/`; `js/app.js` is generated (`node tools/app-js.mjs`) and is not in git.
  A new game file must be added to `js/files.js`.
- For a big change, open an issue first to discuss it.

## Testing

```bash
just test
```

- `just test`: the screen harness (`errores: 0`) and the shim tests.
- `make -C native core-test`: the C core checked against the JS.
- `just check`: builds every platform. Required if you touch `native/`, the shims or the build scripts.
- If you change something visible, try it on the web (`just web-local`) and, if you can, on the platform it affects.

## Controls

Everything you can pick with a controller can also be picked with a click or a tap; ○ / Esc always goes back;
anything that can't be undone asks for confirmation with the focus on "No". Texts never spell out buttons by hand:
use the tokens (`{confirm}`, `{back}`…) from `native/shim/ui.js`.

## Commits

- Conventional Commits, short, in English or Spanish: `type(scope): what` (`feat`, `fix`, `perf`, `chore`, `docs`,
  `refactor`, `test`).
- No secrets: `.env`, console keys, keystores and service accounts are in `.gitignore` and are never pushed.

## License of your contributions

Whatever you contribute falls under the license of the part of the repository you touch: the game (`js/`, `css/`,
`index.html`, `tools/`) under [PolyForm Noncommercial 1.0.0](LICENSE-NONCOMMERCIAL.md) and the native engine
(`native/`) under [GPL-3.0-or-later](native/LICENSE). Don't contribute code or assets you can't share that way
(third-party sprites, music or code under another license, or anything from Nintendo / The Pokémon Company).

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

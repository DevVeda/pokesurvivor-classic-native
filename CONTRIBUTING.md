# Contribuir

Gracias por querer ayudar. Esto es un proyecto de fan, gratis y sin ánimo de lucro.

## Antes de empezar

- Se trabaja en la rama **`dev`**: un solo código para todas las plataformas. No hay ramas por plataforma.
- Lo que cambia de una plataforma a otra va en `native/platform/<nombre>.c` (C) o se pregunta a `ps.CAN`
  (JS, en `native/shim/browser.js` y `native/shim/web.js`). Nunca por el nombre de la plataforma.
- El juego son las fuentes de `js/<área>/`; `js/app.js` se genera (`node tools/app-js.mjs`) y no va en git.
  Un archivo nuevo del juego se añade a `js/files.js`.
- Para un cambio grande, abre antes un issue para hablarlo.

## Probar

```bash
just test
```

- `just test`: el arnés de las pantallas (`errores: 0`) y las pruebas de los shims.
- `make -C native core-test`: el núcleo en C contra el JS.
- `just check`: compila todas las plataformas. Obligatorio si tocas `native/`, los shims o los scripts de build.
- Si cambias algo que se ve, pruébalo en la web (`just web-local`) y, si puedes, en la plataforma que toque.

## Controles

Todo lo que se elige con el mando se elige también con un clic o con el dedo; ○ / Esc vuelve siempre;
lo que no se deshace pide confirmación con el foco en «No». Los textos no llevan botones escritos a mano:
se usan los tokens (`{confirm}`, `{back}`…) de `native/shim/ui.js`.

## Commits

- Estilo Conventional Commits, en español y cortos: `tipo(ámbito): qué` (`feat`, `fix`, `perf`, `chore`,
  `docs`, `refactor`, `test`).
- Nada de secretos: `.env`, claves de consola, keystores y cuentas de servicio están en `.gitignore` y no se
  suben nunca.

## Licencia de lo que aportes

Lo que aportes queda bajo la licencia de la parte del repositorio que tocas: el juego (`js/`, `css/`,
`index.html`, `tools/`) bajo [PolyForm Noncommercial 1.0.0](LICENSE-NONCOMMERCIAL.md) y el motor nativo
(`native/`) bajo [GPL-3.0-or-later](native/LICENSE). No aportes código ni recursos que no puedas compartir
así (sprites, música o código de terceros con otra licencia, o de Nintendo / The Pokémon Company).

Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.md).

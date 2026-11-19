# Seguridad

## Avisar de un fallo

**No abras un issue público.** Usa el aviso privado de GitHub: pestaña *Security* → *Report a vulnerability*
de este repositorio. Cuenta qué es, cómo reproducirlo y qué afecta. Contestaremos en cuanto podamos.

## Qué interesa

- Las reglas de la base de datos (`firestore.rules`, `database.rules.json`): leer o escribir partidas,
  perfiles, ranking o salas de otros.
- Las actualizaciones de las versiones nativas (`native/update.c`, `native/shim/update.js`): instalar algo
  que no esté firmado con la clave del servidor.
- La red de las versiones nativas (`native/net.c`, `native/shim/net.js`) y el cooperativo (`native/webrtc.c`).
- Cualquier secreto que se haya colado en el repositorio o en su historial.

## Qué no

- Trampas en tu propia partida o en el ranking de tu propio servidor.
- Fallos de servidores ajenos que usen este código: avisa a quien lo lleve.

Prueba sólo contra tu propio servidor (`env.example`) y tus propias cuentas.

# Security

## Reporting a vulnerability

**Don't open a public issue.** Use GitHub's private reporting: this repository's *Security* tab → *Report a
vulnerability*. Explain what it is, how to reproduce it and what it affects. We'll answer as soon as we can.

## In scope

- The database rules (`firestore.rules`, `database.rules.json`): reading or writing other players' saves,
  profiles, rankings or rooms.
- Updates of the native builds (`native/update.c`, `native/shim/update.js`): installing anything not signed
  with the server's key.
- Networking in the native builds (`native/net.c`, `native/shim/net.js`) and co-op (`native/webrtc.c`).
- Any secret that slipped into the repository or its history.

## Out of scope

- Cheating in your own run or on your own server's ranking.
- Bugs in other people's servers running this code: report them to whoever runs that server.

Only test against your own server (`env.example`) and your own accounts.

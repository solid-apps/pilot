# pilot

A minimalist Solid console. Three views — Profile, Tasks, Settings — all backed by your real pod via [xlogin](https://unpkg.com/xlogin).

Live: <https://solid-apps.github.io/pilot/>

## What it does

- **Profile**: fetches your WebID document as JSON-LD, normalizes common foaf/vcard predicates, click-to-edit any field. Edits PUT back to the WebID URL preserving pod-only fields (`solid:oidcIssuer`, `space:storage`, etc.).
- **Tasks**: discovers `wf:Tracker` registrations through `solid:publicTypeIndex`, fetches each tracker, renders kanban columns. Add / toggle / edit / delete tasks → debounced PUT.
- **Settings**: light/dark theme (localStorage), live login state, TypeIndex registrations debug view.

Onboarding shows when you're not signed in — a focused welcome card pointing at the floating sign-in button. After login the SPA loads and remembers your last-visited route.

## Stack

- Preact (`https://esm.sh/preact@10`) + htm — no build step
- xlogin for Solid OIDC + Nostr
- Pure pod-side data — no embedded sample islands

Pod requirement: serves `application/ld+json` via content negotiation. Pods that only return Turtle won't work yet (a small N3 parser would unblock — separate project).

## Origin

Graduated from the [solid-preact lab](https://github.com/solid-apps/solid-apps.github.io/tree/gh-pages/preact) (stages 01-hello → 07-combined). The lab proved the patterns; pilot is the trimmed, focused outcome — no demo cruft, just a real tool.

## License

Code: AGPL-3.0.

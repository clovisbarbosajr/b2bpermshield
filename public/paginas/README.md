# PermShield B2B Portal

This package contains four standalone pages:

- `index.html` — main B2B portal selection page.
- `admin-login.html` — administrator login.
- `customers-login.html` — customer login.
- `reset-password.html` — customer password recovery.

All pages share `styles.css`, `app.js`, and the local files in `assets/`. Relative links allow the package to work from a static host or when opened directly from disk.

## Authentication integration

The forms intentionally use `action="#"` as a safe visual prototype. Replace `#` with the existing authentication endpoint. The JavaScript allows a real submission automatically once the action is changed. Login field names are `username` and `password`; the recovery field is `email`.

## Existing application routes

When integrating into the current B2B app, map:

- `index.html` to `/`
- `admin-login.html` to `/admin-login`
- `customers-login.html` to `/customers-login`
- `reset-password.html` to `/reset-password`

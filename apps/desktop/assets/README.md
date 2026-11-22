# App icon

The app icon lives here as **`icon.png`**: square, 1024 × 1024, PNG with a
transparent background. To replace it, overwrite that file. The desktop app picks it up on its next start (Dock
icon on macOS, window icon on Windows and Linux).

For packaged builds, generate the platform formats from it:

```bash
node scripts/make-icons.mjs
```

That writes `icon.icns` (macOS, needs `sips` and `iconutil`, so run it on a
Mac) and `icon.ico` (Windows) next to `icon.png`.

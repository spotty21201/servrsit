# Geist Sans and Geist Mono (self-hosted)

Source: https://github.com/vercel/geist-font, release v1.9.2
(`geist-font-v1.9.2.zip`, sha256 `15f066d58dcb99fb10014a49913009fdaf41e464cfb8851a44b44e593c95d3d8`).
License: SIL Open Font License 1.1, see `OFL.txt` (copied from the release).

Files are the release's static `webfonts/*.woff2`, unmodified. Only the weights
the UI uses are included: 400 Regular, 500 Medium, 600 SemiBold, for both
Geist (Sans) and Geist Mono. No italics. Declared in `apps/web/src/fonts.css`.
To change weights, add the file here and its `@font-face` there together.

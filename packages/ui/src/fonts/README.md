# ServrSit — Font files

ServrSit uses two open-licensed font families. **Font files are NOT bundled in
this repository and are NOT downloaded automatically.** You must obtain them
manually and place them here before the application will render the correct
typefaces.

This is intentional: the spec requires production to serve fonts through the
application's own delivery path rather than relying on an external CDN. It also
keeps binary assets outside version control.

---

## 1. Bricolage Grotesque

**Role:** Brand and display headings (briefing headline, page titles, server names).  
**Weights needed:** 650 and 700 (the spec calls for 650–700, normal width).  
**Source:** <https://github.com/ateliertriay/bricolage>  
**License:** SIL Open Font License 1.1 — see the license file in that repository.
Preserve the license alongside the font files.

### Steps

1. Visit <https://github.com/ateliertriay/bricolage/releases> and download the
   latest release archive.
2. From the archive, copy the variable font file(s) for the normal (non-condensed)
   width into this directory:

   ```
   packages/ui/src/fonts/BricolageGrotesque-VariableFont_opsz,wdth,wght.woff2
   ```

   If a variable font is not available, copy the static files for weights 600,
   700 (use weight 600 as a stand-in for 650 until variable axis support is
   confirmed in the browser targets).

3. Verify the file hash matches the release checksum before committing.

### @font-face declaration (add to typography.css once files are in place)

```css
@font-face {
  font-family: "Bricolage Grotesque";
  src: url("./BricolageGrotesque-VariableFont_opsz,wdth,wght.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

If using static files only:

```css
@font-face {
  font-family: "Bricolage Grotesque";
  src: url("./BricolageGrotesque-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Bricolage Grotesque";
  src: url("./BricolageGrotesque-SemiBold.woff2") format("woff2");
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Bricolage Grotesque";
  src: url("./BricolageGrotesque-Bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

---

## 2. Geist Sans

**Role:** Interface, body, forms, buttons.  
**Weights needed:** 400 (prose), 500 (labels), 600 (actions/buttons).  
**Source:** <https://github.com/vercel/geist-font>  
**License:** SIL Open Font License 1.1 — see the license file in that repository.
Preserve the license alongside the font files.

**Note:** Geist is maintained by Vercel but does not require Vercel hosting.
Serve the files yourself.

### Steps

1. Visit <https://github.com/vercel/geist-font/releases> and download the latest
   release archive.
2. From the archive, locate the `Geist Sans` woff2 files and copy the weights
   you need into this directory:

   ```
   packages/ui/src/fonts/Geist-Regular.woff2
   packages/ui/src/fonts/Geist-Medium.woff2
   packages/ui/src/fonts/Geist-SemiBold.woff2
   ```

   If a variable font file is available, prefer that:

   ```
   packages/ui/src/fonts/Geist-VariableFont_wght.woff2
   ```

3. Verify file hashes against release checksums before committing.

### @font-face declaration (add to typography.css once files are in place)

Variable font version:

```css
@font-face {
  font-family: "Geist";
  src: url("./Geist-VariableFont_wght.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

Static files version:

```css
@font-face {
  font-family: "Geist";
  src: url("./Geist-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Geist";
  src: url("./Geist-Medium.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Geist";
  src: url("./Geist-SemiBold.woff2") format("woff2");
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}
```

---

## 3. Geist Mono

**Role:** Addresses, package versions, timestamps in evidence panels, transcripts.  
**Weights needed:** 400–500.  
**Source:** <https://github.com/vercel/geist-font> (same repository as Geist Sans,
under the `Geist Mono` subdirectory of the release archive).  
**License:** SIL Open Font License 1.1 — same as Geist Sans.

### Steps

1. From the same Geist release archive, copy the `Geist Mono` woff2 files:

   ```
   packages/ui/src/fonts/GeistMono-Regular.woff2
   packages/ui/src/fonts/GeistMono-Medium.woff2
   ```

   Or the variable version:

   ```
   packages/ui/src/fonts/GeistMono-VariableFont_wght.woff2
   ```

2. Verify file hashes.

### @font-face declaration (add to typography.css once files are in place)

Variable font version:

```css
@font-face {
  font-family: "Geist Mono";
  src: url("./GeistMono-VariableFont_wght.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  font-feature-settings: "tnum" 1; /* tabular figures */
}
```

Static files version:

```css
@font-face {
  font-family: "Geist Mono";
  src: url("./GeistMono-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  font-feature-settings: "tnum" 1;
}

@font-face {
  font-family: "Geist Mono";
  src: url("./GeistMono-Medium.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
  font-feature-settings: "tnum" 1;
}
```

---

## Checklist before committing font files

- [ ] Downloaded from the official repository release, not a third-party mirror.
- [ ] File hash verified against the release checksum.
- [ ] License file (`OFL.txt` or equivalent) copied alongside the font files.
- [ ] Variable font preferred over static files where available.
- [ ] Only the weights actually used by the application are included.
- [ ] `@font-face` declarations added to `src/tokens/typography.css`.
- [ ] Font files listed in `.gitignore` exception or committed as tracked binary assets
      (decide with the team — do NOT rely on a CDN or external URL in production).

---

## Why not use the npm packages?

`@fontsource/*` packages exist for both fonts and are convenient for development.
They are **not suitable for production** in this application because:

1. The spec requires pinned, self-hosted assets on the application's delivery path.
2. npm fontsource packages are regularly updated and do not carry a lockfile guarantee
   of the exact binary files delivered to the browser.
3. Verifying hashes is easier when you fetch directly from the GitHub release.

For local development only, a developer may temporarily reference a CDN or fontsource
package. That reference must never reach staging or production.

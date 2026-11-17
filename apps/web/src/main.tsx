/**
 * ServrSit web app — entry point
 *
 * Imports design tokens first so CSS custom properties are defined
 * before any component styles are applied.
 */
import "./tokens.css";
import "./fonts.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "Root element #root not found. Check index.html has <div id='root'></div>."
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/**
 * SkipLink: the first Tab stop on every page (UX Spec accessibility, D-U2).
 * Visible only while focused. Activating it moves focus to <main id="main-content">
 * (every page's main has tabIndex -1) without changing the URL.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link"
      onClick={(e) => {
        const main = document.getElementById("main-content");
        if (!main) return;
        e.preventDefault();
        main.focus();
        main.scrollIntoView({ block: "start" });
      }}
    >
      Skip to main content
    </a>
  );
}

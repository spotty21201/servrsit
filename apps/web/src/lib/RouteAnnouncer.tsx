import { useEffect, useState } from "react";
import { onAnnounce } from "./pageTitle";

/** One polite live region for route changes. Always mounted so the first message is spoken. */
export function RouteAnnouncer() {
  const [message, setMessage] = useState("");
  useEffect(() => onAnnounce(setMessage), []);
  return <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-route-announcer="">{message}</div>;
}

/**
 * SchedulerNotice — "Checks paused", "Check delayed" or "Scheduler
 * unavailable" (UX Spec §13.2). Icon + text, attention or failed colours.
 * Paused monitoring is never an all-clear, and the text says so.
 */
import type { SchedulerNoticeVM } from "./findingsViewModel";
import c from "../care/care.module.css";

export function SchedulerNotice({ notice }: { notice: SchedulerNoticeVM }) {
  return (
    <div className={`${c.notice} ${notice.tone === "failed" ? c.noticeFailed : c.noticeAttention}`} role="status" data-scheduler={notice.key}>
      <p className={c.noticeTitle}>
        <svg width="16" height="16" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
          <rect x="2" y="1" width="1" height="6" fill="currentColor" /><rect x="5" y="1" width="1" height="6" fill="currentColor" />
        </svg>
        {notice.title}
      </p>
      <p>{notice.text}</p>
    </div>
  );
}

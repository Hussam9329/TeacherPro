"use client";

import { Handshake } from "lucide-react";
import { baghdadDateKey } from "@/lib/baghdad-time";
import type { StudentPledgeSummary } from "@/lib/pledge-limit";

/** «25/09/2026» in Baghdad time. */
export function pledgeDateLabel(iso: string): string {
  const [year, month, day] = baghdadDateKey(iso).split("-");
  return year ? `${day}/${month}/${year}` : "—";
}

/**
 * A student card's pledges in the active chapter: «التعهدات 1 من 2» and
 * their dates. Red once the limit is reached.
 */
export function PledgeChip({ pledges, showEmpty = false }: {
  pledges?: StudentPledgeSummary | null;
  showEmpty?: boolean;
}) {
  if (!pledges?.chapterId || (pledges.count === 0 && !showEmpty)) return null;
  const dates = pledges.dates.map(pledgeDateLabel).join(" · ");
  const title = `التعهدات في «${pledges.chapterName}»: ${pledges.count} من ${pledges.limit}${dates ? ` — ${dates}` : ""}`;
  return (
    <span
      className="tp-scard__chip tp-pledge-chip"
      data-tone={pledges.limitReached ? "danger" : pledges.count > 0 ? "warning" : "muted"}
      title={title}
    >
      <Handshake aria-hidden="true" />
      <span>التعهدات <bdi dir="ltr">{pledges.count}/{pledges.limit}</bdi></span>
      {dates ? <bdi className="tp-pledge-chip__dates" dir="ltr">{dates}</bdi> : null}
    </span>
  );
}

import type { EventType, LicenseState } from "./types";

const IST = "Asia/Kolkata";
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...o });
const dMon = fmt({ day: "numeric", month: "short" });
const dMonYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const dMonYearTime = fmt({ day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const time = fmt({ hour: "numeric", minute: "2-digit", hour12: true });
const weekday = fmt({ weekday: "long" });
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });

export const fmtDay = (d: string | Date) => dMon.format(new Date(d));
export const fmtDate = (d: string | Date) => dMonYear.format(new Date(d));
export const fmtDateTime = (d: string | Date) => dMonYearTime.format(new Date(d));
export const fmtTime = (d: string | Date) => time.format(new Date(d));
export const fmtWeekday = (d: string | Date) => weekday.format(new Date(d));

/** India calendar date as YYYY-MM-DD, `offset` days from today. */
export function istDate(offset = 0, from: Date = new Date()): string {
  return ymd.format(new Date(from.getTime() + offset * 86_400_000));
}

/** A plain YYYY-MM-DD (from the database) shown as "12 Mar". Parsed as UTC noon so no timezone can shift the day. */
export const fmtYmd = (s: string) => dMon.format(new Date(`${s}T12:00:00Z`));
export const fmtYmdFull = (s: string) => dMonYear.format(new Date(`${s}T12:00:00Z`));

/** "12m ago", "3h ago", "2d ago". */
export function ago(iso: string | null, now = new Date()): string {
  if (!iso) return "Never";
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export function daysLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "Lifetime";
  if (daysLeft > 1) return `${daysLeft} days left`;
  if (daysLeft === 1) return "1 day left";
  if (daysLeft === 0) return "Expires today";
  return `Expired ${-daysLeft}d ago`;
}

export const STATE_LABEL: Record<LicenseState, string> = {
  active: "Active",
  expiring: "Expiring soon",
  grace: "In grace period",
  expired: "Expired",
  suspended: "Suspended",
};

export const STATE_TONE: Record<LicenseState, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  expiring: "warning",
  grace: "warning",
  expired: "danger",
  suspended: "danger",
};

export const EVENT_LABEL: Record<EventType, string> = {
  created: "Client onboarded",
  updated: "Details updated",
  renewed: "License renewed",
  suspended: "Account suspended",
  reactivated: "Account reactivated",
  device_bound: "Terminal linked",
  device_reset: "Terminal binding reset",
  activated: "License activated",
  plan_updated: "Plan updated",
  admin_added: "Team member added",
  admin_removed: "Team member removed",
  key_regenerated: "License key replaced",
};

export const EVENT_ICON: Record<EventType, string> = {
  created: "add_business",
  updated: "edit",
  renewed: "autorenew",
  suspended: "block",
  reactivated: "lock_open",
  device_bound: "computer",
  device_reset: "laptop_windows",
  activated: "verified",
  plan_updated: "sell",
  admin_added: "person_add",
  admin_removed: "person_remove",
  key_regenerated: "key",
};

export const EVENT_TONE: Record<EventType, "success" | "warning" | "danger" | "neutral" | "primary"> = {
  created: "primary",
  updated: "neutral",
  renewed: "success",
  suspended: "danger",
  reactivated: "success",
  device_bound: "neutral",
  device_reset: "warning",
  activated: "success",
  plan_updated: "neutral",
  admin_added: "neutral",
  admin_removed: "warning",
  key_regenerated: "warning",
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A one-line description of an audit event for lists. */
export function describeEvent(e: { event: EventType; reason: string; payload: Record<string, unknown> }): string {
  const p = e.payload;
  switch (e.event) {
    case "renewed":
      return `Plan ${p.plan}, ${p.periods} period${p.periods === 1 ? "" : "s"}, ₹${(Number(p.total_paise ?? 0) / 100).toLocaleString("en-IN")} via ${p.method}${p.reference ? ` (${p.reference})` : ""}.`;
    case "created":
      return `${p.code} on the ${p.plan} plan with ${p.max_devices} terminal${p.max_devices === 1 ? "" : "s"}.`;
    case "device_bound":
    case "activated":
      return `${p.device_name || "A PC"} linked (${p.machine_id}).`;
    case "device_reset":
      return `${p.device_name || "A PC"} (${p.machine_id}) unlinked. ${e.reason}`;
    case "updated":
      return `Changed: ${((p.changed as string[]) ?? []).join(", ")}.`;
    case "plan_updated":
      return `Plan ${p.plan}: ₹${(Number(p.price_paise ?? 0) / 100).toLocaleString("en-IN")}, ${p.max_devices} terminals, ${p.active ? "on sale" : "off sale"}.`;
    case "admin_added":
      return `${p.email} as ${p.role}.`;
    case "admin_removed":
      return `${p.name} removed from the team.`;
    case "key_regenerated":
      return `Key ending ${p.old_tail} replaced by one ending ${p.new_tail}. ${e.reason}`;
    default:
      return e.reason;
  }
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Async } from "@/components/console-ui";
import { Badge, Button, Card, Chip, EmptyState, Icon, PageHeader, SearchInput, cx } from "@/components/ui";
import { ago, describeEvent, EVENT_ICON, EVENT_LABEL, EVENT_TONE, fmtDateTime, fmtTime, fmtWeekday, fmtYmdFull, istDate } from "@/lib/format";
import { useAsync, useCopy, useDebounced, useNowMs } from "@/lib/hooks";
import { useApi } from "@/lib/portal";
import type { EventRow, EventType } from "@/lib/types";

type Preset = "today" | "7" | "30" | "all";
const FILTERS: EventType[] = ["renewed", "created", "suspended", "reactivated", "device_reset", "device_bound", "activated", "updated"];
const STEP = 25;

export default function ActivityPage() {
  const api = useApi();
  const now = useNowMs();
  const [event, setEvent] = useState<EventType | "">("");
  const [actor, setActor] = useState("");
  const [preset, setPreset] = useState<Preset>("30");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(STEP);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const debounced = useDebounced(search);
  const { copy, copied } = useCopy();

  const today = istDate(0, new Date(now));
  const from = preset === "today" ? today : preset === "7" ? istDate(-6, new Date(now)) : preset === "30" ? istDate(-29, new Date(now)) : undefined;

  const { data, error, loading, reload } = useAsync(
    () => api.activity({ event: event || undefined, actor: actor || undefined, from, search: debounced, limit }),
    [api, event, actor, from, debounced, limit],
  );
  const counts = data?.counts ?? {};
  const all = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  const filtering = (fn: () => void) => () => {
    fn();
    setLimit(STEP);
  };

  // group by India calendar day, newest first (the rows already arrive newest first)
  const groups: { day: string; rows: EventRow[] }[] = [];
  for (const r of data?.rows ?? []) {
    const day = istDate(0, new Date(r.created_at));
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  const dayTitle = (day: string) => (day === today ? "Today" : day === istDate(-1, new Date(now)) ? "Yesterday" : fmtWeekday(`${day}T12:00:00Z`));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Audit trail"
        title="Activity log"
        subtitle="Every change to a client or license: who did it, and when. Entries cannot be edited or deleted."
      />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={event === ""} count={all} onClick={filtering(() => setEvent(""))}>All events</Chip>
          {FILTERS.filter((f) => (counts[f] ?? 0) > 0 || event === f).map((f) => (
            <Chip key={f} active={event === f} count={counts[f] ?? 0} onClick={filtering(() => setEvent(f))}>{EVENT_LABEL[f]}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput className="w-[300px]" value={search} onChange={(v) => { setSearch(v); setLimit(STEP); }} placeholder="Restaurant, person or note…" />
          <span className="ml-2 text-label-md uppercase tracking-wider text-muted">When</span>
          {([["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["all", "All time"]] as [Preset, string][]).map(([k, label]) => (
            <Chip key={k} active={preset === k} onClick={filtering(() => setPreset(k))}>{label}</Chip>
          ))}
          <span className="ml-2 text-label-md uppercase tracking-wider text-muted">Who</span>
          <Chip active={actor === ""} onClick={filtering(() => setActor(""))}>Everyone</Chip>
          {(data?.actors ?? []).map((a) => (
            <Chip key={a.user_id} active={actor === a.user_id} onClick={filtering(() => setActor(a.user_id))}>{a.name}</Chip>
          ))}
        </div>
      </Card>

      <Async error={error} loading={loading} hasData={!!data} onRetry={reload}>
        {data && (
          <div className="grid grid-cols-[1fr_400px] items-start gap-5">
            <div className={cx("space-y-5 transition-opacity", loading && "opacity-60")}>
              {groups.length === 0 && <Card><EmptyState icon="history" title="No activity found">Try another filter or time range.</EmptyState></Card>}
              {groups.map((g) => (
                <section key={g.day} aria-label={dayTitle(g.day)}>
                  <h2 className="mb-2 flex items-center gap-2 text-label-md uppercase tracking-wider text-muted">
                    {dayTitle(g.day)} <span className="font-normal normal-case">{fmtYmdFull(g.day)}</span> <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm">{g.rows.length}</span>
                  </h2>
                  <div className="space-y-3">
                    {g.rows.map((e) => {
                      const sel = selected?.id === e.id;
                      return (
                        <button key={e.id} type="button" onClick={() => setSelected(e)} aria-pressed={sel} className={cx("block w-full rounded-2xl border bg-surface-lowest p-4 text-left shadow-level1 transition-all hover:shadow-level2", sel ? "border-primary ring-2 ring-primary/30" : "border-line")}>
                          <div className="flex items-start gap-3">
                            <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", e.event === "suspended" || e.event === "device_reset" ? "bg-error-container text-error" : e.event === "renewed" || e.event === "reactivated" || e.event === "activated" ? "bg-[#dcfce7] text-tertiary" : "bg-primary-fixed text-primary")}>
                              <Icon name={EVENT_ICON[e.event]} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="flex items-center gap-2"><span className="text-label-lg">{EVENT_LABEL[e.event]}</span><Badge tone={EVENT_TONE[e.event]}>{e.event.replace("_", " ")}</Badge></span>
                                <span className="font-mono text-body-sm text-muted">#{e.id}</span>
                              </div>
                              {e.restaurant_name && <div className="text-label-md text-primary">{e.restaurant_name} <span className="font-normal text-muted">· {e.restaurant_city}</span></div>}
                              <p className="mt-1 text-body-md text-ink-variant">{describeEvent(e)}</p>
                              <div className="mt-2 flex items-center gap-2 text-body-sm text-muted">
                                <Icon name={e.actor_name === "System" || e.actor_name === "Restaurant PC" ? "smart_toy" : "person"} className="text-[16px]" /> {e.actor_name}
                                <span>·</span> {fmtTime(e.created_at)} ({ago(e.created_at, new Date(now))})
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              <div className="flex items-center justify-between text-body-md text-muted">
                <span>Showing {data.rows.length} of {data.total} entries</span>
                {data.rows.length < data.total && <Button variant="secondary" icon="expand_more" onClick={() => setLimit(limit + STEP)}>Load more</Button>}
              </div>
            </div>

            <div className="sticky top-20">
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Icon name="fingerprint" className="text-primary" />
                  <h2 className="text-headline-sm">Entry details</h2>
                </div>
                {!selected ? (
                  <p className="rounded-xl bg-surface-low p-4 text-body-md text-muted">Select an entry to see exactly what was recorded.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-xl bg-surface-low p-3">
                      <div className="text-label-sm uppercase tracking-wider text-muted">Event</div>
                      <div className="text-label-lg">{EVENT_LABEL[selected.event]}</div>
                      {selected.restaurant_name && <Link href={`/clients/view/?id=${selected.restaurant_id}`} className="text-body-md text-primary hover:underline">{selected.restaurant_name}</Link>}
                    </div>
                    <dl className="space-y-2 text-body-md">
                      <Row k="Done by" v={selected.actor_name} />
                      <Row k="When" v={fmtDateTime(selected.created_at)} />
                      <Row k="Entry" v={`#${selected.id}`} />
                      {selected.reason && <Row k="Reason" v={selected.reason} />}
                    </dl>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-label-sm uppercase tracking-wider text-muted">Details recorded</span>
                        <button type="button" onClick={() => copy(JSON.stringify(selected.payload, null, 2), "raw")} className="flex items-center gap-1 text-label-md text-primary hover:underline">
                          <Icon name={copied === "raw" ? "check" : "content_copy"} className="text-[16px]" /> {copied === "raw" ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <pre className="scroll-thin max-h-72 overflow-auto rounded-xl bg-charcoal p-3 font-mono text-[12px] leading-5 text-[#f2f1ee]">{JSON.stringify(selected.payload, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-label-md uppercase tracking-wider text-muted">{k}</dt>
      <dd className="min-w-0 flex-1 break-words">{v}</dd>
    </div>
  );
}

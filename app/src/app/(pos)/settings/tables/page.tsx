"use client";

import { useState } from "react";
import { SettingsSection } from "@/components/settings-ui";
import { Button, EmptyState, Icon, cx, inputClass } from "@/components/ui";
import { usePos } from "@/lib/pos-store";
import type { DiningTable } from "@/lib/types";

// Dining tables: add, rename, change seats, remove. Removed tables disappear from the floor,
// but bills already made on them keep their table label.
export default function TablesSettingsPage() {
  const { state, dispatch, tables, openBills } = usePos();
  const busy = new Set(openBills.map((b) => b.tableId).filter(Boolean));

  const nextLabel = () => {
    const nums = state.tables.map((t) => Number(/^T(\d+)$/i.exec(t.label)?.[1] ?? 0));
    return `T${Math.max(0, ...nums) + 1}`;
  };

  return (
    <SettingsSection
      icon="table_restaurant"
      title="Tables"
      subtitle={`${tables.length} ${tables.length === 1 ? "table" : "tables"} on the floor`}
      actions={
        <Button
          variant="primary"
          icon="add"
          onClick={() =>
            dispatch({ type: "upsertTable", table: { id: `tb${Date.now().toString(36)}`, label: nextLabel(), seats: 4, active: true } })
          }
        >
          Add table
        </Button>
      }
    >
      {tables.length === 0 ? (
        <EmptyState icon="table_restaurant" title="No tables">
          Takeaway and delivery work without tables. Add tables if you serve dine-in guests.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {tables.map((t) => (
            <TableRow
              key={t.id}
              table={t}
              inUse={busy.has(t.id)}
              others={tables.filter((x) => x.id !== t.id).map((x) => x.label.toLowerCase())}
              onChange={(table) => dispatch({ type: "upsertTable", table })}
            />
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function TableRow({
  table,
  inUse,
  others,
  onChange,
}: {
  table: DiningTable;
  inUse: boolean;
  others: string[];
  onChange: (t: DiningTable) => void;
}) {
  const [label, setLabel] = useState(table.label);
  const trimmed = label.trim();
  const clash = others.includes(trimmed.toLowerCase());
  const invalid = !trimmed || clash;

  const commit = () => {
    if (invalid) {
      setLabel(table.label); // put the old name back rather than save a bad one
      return;
    }
    if (trimmed !== table.label) onChange({ ...table, label: trimmed });
  };

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface-lowest p-3">
      <div className="flex-1">
        <input
          aria-label={`Name of table ${table.label}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cx(inputClass, "h-11 font-semibold", invalid && "ring-2 ring-error")}
        />
        {clash && <div className="mt-1 text-body-sm text-error">Another table already has this name</div>}
        {inUse && !clash && <div className="mt-1 text-body-sm text-primary">Has an open bill</div>}
      </div>
      <div className="flex h-11 items-center rounded-lg bg-surface-low" role="group" aria-label={`Seats at ${table.label}`}>
        <button
          type="button"
          aria-label="Fewer seats"
          disabled={table.seats <= 1}
          onClick={() => onChange({ ...table, seats: table.seats - 1 })}
          className="flex h-11 w-10 items-center justify-center rounded-lg hover:bg-surface-high disabled:opacity-30"
        >
          <Icon name="remove" className="text-[20px]" />
        </button>
        <span className="tnum w-14 text-center text-label-lg">{table.seats} seats</span>
        <button
          type="button"
          aria-label="More seats"
          disabled={table.seats >= 50}
          onClick={() => onChange({ ...table, seats: table.seats + 1 })}
          className="flex h-11 w-10 items-center justify-center rounded-lg hover:bg-surface-high disabled:opacity-30"
        >
          <Icon name="add" className="text-[20px]" />
        </button>
      </div>
      <button
        type="button"
        aria-label={`Remove table ${table.label}`}
        title={inUse ? "Settle or move the open bill first" : "Remove table"}
        disabled={inUse}
        onClick={() => onChange({ ...table, active: false })}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-error-container hover:text-error disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
      >
        <Icon name="delete" className="text-[20px]" />
      </button>
    </li>
  );
}

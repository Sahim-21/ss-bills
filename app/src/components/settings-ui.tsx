"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Icon } from "./ui";

export function SettingsSection({
  icon,
  title,
  subtitle,
  children,
  actions,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
            <Icon name={icon} />
          </span>
          <div>
            <h2 className="text-headline-md">{title}</h2>
            {subtitle && <p className="text-body-md text-muted">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

/** Sticky save bar shown when a settings form has unsaved changes. */
export function SaveBar({ dirty, onSave, onDiscard }: { dirty: boolean; onSave: () => void; onDiscard: () => void }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);
  if (!dirty && !saved) return null;
  return (
    <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-between rounded-2xl bg-charcoal px-5 py-3 text-white shadow-level3">
      <span className="flex items-center gap-2 text-label-lg">
        <Icon name={saved ? "check_circle" : "edit"} className={saved ? "icon-fill text-online" : ""} />
        {saved ? "Saved" : "You have unsaved changes"}
      </span>
      {!saved && (
        <div className="flex gap-2">
          <Button variant="ghost" className="text-white! hover:bg-white/10!" onClick={onDiscard}>
            Discard
          </Button>
          <Button
            variant="primary"
            icon="save"
            onClick={() => {
              onSave();
              setSaved(true);
            }}
          >
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}

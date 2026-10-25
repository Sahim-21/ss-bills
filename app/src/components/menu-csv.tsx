"use client";

// Menu import and export as a CSV file (opens in Excel and Google Sheets). The desktop app does the work in its main process
// (electron/menu-service.cjs): files are chosen in system dialogs, and the import is previewed first and applied by a token,
// so nothing is written that was not shown here. Nothing is ever deleted by an import.
import { useState } from "react";
import { formatINRShort } from "@/lib/money";
import { Button, Icon, Modal, cx } from "./ui";

type Problem = { line: number; message: string };
type Sample = { action: "add" | "update"; category: string; name: string; pricePaise: number; was?: number };
type Preview =
  | { cancelled: true }
  | { ok: false; fileName: string; errors: Problem[]; totalErrors: number }
  | {
      ok: true;
      token: string;
      fileName: string;
      encoding: string;
      ignoredColumns: string[];
      summary: { create: number; update: number; unchanged: number; newCategories: number };
      newCategories: string[];
      samples: Sample[];
    };
type Applied = { created: number; updated: number; unchanged: number; categoriesCreated: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function MenuCsvTools({ onChanged }: { onChanged: () => Promise<void> }) {
  const api = typeof window === "undefined" ? undefined : window.ssbills;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ filePath: string; items: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);

  if (!api) return null; // CSV tools live in the desktop app

  function reset() {
    setError(null);
    setExported(null);
    setPreview(null);
    setApplied(null);
  }

  async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    setPreview(null);
    setApplied(null);
    const r = await run(() => api!.menu<{ cancelled: true } | { filePath: string; items: number }>("exportCsv"));
    if (r && !("cancelled" in r)) setExported(r);
  }

  async function choose() {
    setExported(null);
    setApplied(null);
    const r = await run(() => api!.menu<Preview>("importCsvPreview"));
    if (r && !("cancelled" in r)) setPreview(r);
  }

  async function apply(token: string) {
    const r = await run(() => api!.menu<Applied>("importCsvApply", { token }));
    if (r) {
      setApplied(r);
      setPreview(null);
      await onChanged();
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        icon="csv"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Import / Export
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} className="max-w-2xl" labelledBy="csv-title">
        <div className="space-y-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="csv-title" className="text-headline-md">
                Menu CSV file
              </h2>
              <p className="text-body-md text-muted">Type or paste your whole menu in Excel or Google Sheets, then bring it in here. Nothing is ever deleted by an import.</p>
            </div>
            <button type="button" aria-label="Close" disabled={busy} onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-high">
              <Icon name="close" />
            </button>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
              <Icon name="error" className="icon-fill text-[20px]" /> {error}
            </div>
          )}

          {applied && (
            <div role="status" className="rounded-xl bg-[#dcfce7] p-4 text-body-md text-tertiary">
              <div className="flex items-center gap-2 text-label-lg">
                <Icon name="check_circle" className="icon-fill" /> Menu imported
              </div>
              <p className="mt-1">
                Added {plural(applied.created, "item")}
                {applied.categoriesCreated > 0 ? ` (and ${plural(applied.categoriesCreated, "new category", "new categories")})` : ""}, updated {plural(applied.updated, "item")}, left {plural(applied.unchanged, "item")} as they were.
              </p>
            </div>
          )}

          {exported && (
            <div role="status" className="rounded-xl bg-[#dcfce7] p-4 text-body-md text-tertiary">
              <div className="flex items-center gap-2 text-label-lg">
                <Icon name="check_circle" className="icon-fill" /> Saved {plural(exported.items, "item")}
              </div>
              <p className="mt-1 break-all font-mono text-body-sm">{exported.filePath}</p>
            </div>
          )}

          {preview && "ok" in preview && !preview.ok && (
            <div className="rounded-xl border border-error bg-error-container/40 p-4">
              <div className="flex items-center gap-2 text-label-lg text-on-error-container">
                <Icon name="error" className="icon-fill" /> {preview.fileName} was not imported
              </div>
              <p className="mt-1 text-body-md text-on-error-container">
                {plural(preview.totalErrors, "problem")} found. <b>Nothing was imported</b>: fix the file and choose it again.
              </p>
              <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-body-sm text-on-error-container">
                {preview.errors.map((p, i) => (
                  <li key={i}>
                    {p.line > 0 ? <b>Line {p.line}: </b> : null}
                    {p.message}
                  </li>
                ))}
              </ul>
              {preview.totalErrors > preview.errors.length && <p className="mt-2 text-body-sm">…and {preview.totalErrors - preview.errors.length} more.</p>}
            </div>
          )}

          {preview && "ok" in preview && preview.ok && (
            <div className="rounded-xl border border-line bg-surface-low p-4">
              <div className="flex items-center gap-2 text-label-lg">
                <Icon name="fact_check" /> {preview.fileName}: ready to import
              </div>
              <ul className="mt-2 space-y-1 text-body-md">
                <li>
                  <b>{plural(preview.summary.create, "new item")}</b> will be added
                  {preview.summary.newCategories > 0 ? `, in ${plural(preview.summary.newCategories, "new category", "new categories")} (${preview.newCategories.join(", ")})` : ""}
                </li>
                <li>
                  <b>{plural(preview.summary.update, "item")}</b> already on your menu will be updated
                </li>
                <li>{plural(preview.summary.unchanged, "item")} are the same already</li>
                <li className="text-muted">Items that are not in the file stay exactly as they are.</li>
              </ul>
              {preview.samples.length > 0 && (
                <table className="mt-3 w-full text-left text-body-sm">
                  <thead className="text-label-sm uppercase text-muted">
                    <tr>
                      <th className="py-1">What</th>
                      <th className="py-1">Item</th>
                      <th className="py-1">Category</th>
                      <th className="py-1 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.samples.map((s, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="py-1">
                          <span className={cx("rounded px-1.5 py-0.5 text-label-sm", s.action === "add" ? "bg-[#dcfce7] text-tertiary" : "bg-primary-fixed text-on-primary-fixed")}>{s.action === "add" ? "Add" : "Update"}</span>
                        </td>
                        <td className="py-1">{s.name}</td>
                        <td className="py-1 text-muted">{s.category}</td>
                        <td className="tnum py-1 text-right">
                          {s.action === "update" && s.was !== undefined && s.was !== s.pricePaise ? `${formatINRShort(s.was)} → ` : ""}
                          {formatINRShort(s.pricePaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.summary.create + preview.summary.update > preview.samples.length && <p className="mt-1 text-body-sm text-muted">Showing the first few changes.</p>}
              {preview.ignoredColumns.length > 0 && <p className="mt-2 text-body-sm text-muted">Columns that were not used: {preview.ignoredColumns.join(", ")}.</p>}
              {preview.encoding === "Windows-1252" && <p className="mt-2 text-body-sm text-muted">This file was saved by Excel as plain CSV. If a name looks wrong below, save it as &ldquo;CSV UTF-8&rdquo; and choose it again.</p>}
              <div className="mt-4 flex items-center gap-3">
                <Button variant="primary" icon={busy ? "progress_activity" : "upload"} disabled={busy || preview.summary.create + preview.summary.update === 0} onClick={() => void apply(preview.token)}>
                  {busy ? "Importing…" : preview.summary.create + preview.summary.update === 0 ? "Nothing to change" : "Import now"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-surface-low p-4">
              <div className="flex items-center gap-2 text-label-lg">
                <Icon name="download" /> Export
              </div>
              <p className="mt-1 text-body-sm text-muted">Save your menu as a file. It is also the best template for a new menu: edit it in Excel and import it back.</p>
              <Button className="mt-3" variant="secondary" icon={busy ? "progress_activity" : "download"} disabled={busy} onClick={() => void doExport()}>
                Export menu…
              </Button>
            </div>
            <div className="rounded-xl bg-surface-low p-4">
              <div className="flex items-center gap-2 text-label-lg">
                <Icon name="upload_file" /> Import
              </div>
              <p className="mt-1 text-body-sm text-muted">
                Columns: Category, Name, Price, Veg, Short code, Available. Only <b>Name</b> and <b>Price</b> are required. You see what will change before anything is saved.
              </p>
              <Button className="mt-3" variant="primary" icon={busy ? "progress_activity" : "upload_file"} disabled={busy} onClick={() => void choose()}>
                Choose a CSV file…
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

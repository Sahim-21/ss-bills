"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminOnly, Badge, Button, Card, EmptyState, Field, Icon, Modal, SearchInput, Segmented, Toggle, VegMark, cx, inputClass } from "@/components/ui";
import { formatINRShort, rupeesToPaise } from "@/lib/money";
import { usePos } from "@/lib/pos-store";
import type { MenuItem } from "@/lib/types";

export default function MenuPage() {
  const { state, dispatch, isAdmin, categories } = usePos();
  const [pickedId, setCategoryId] = useState(categories[0]?.id ?? "");
  // If the picked category was removed (or none was picked yet), fall back to the first one.
  const categoryId = categories.some((c) => c.id === pickedId) ? pickedId : (categories[0]?.id ?? "");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removingCat, setRemovingCat] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState<MenuItem | null>(null);
  const [newCat, setNewCat] = useState<string | null>(null);

  const live = useMemo(() => state.menu.filter((m) => !m.deleted), [state.menu]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return live.filter((m) =>
      q ? m.name.toLowerCase().includes(q) || m.shortCode.toLowerCase().includes(q) : m.categoryId === categoryId,
    );
  }, [live, query, categoryId]);

  if (!isAdmin) return <AdminOnly />;

  const category = categories.find((c) => c.id === categoryId);
  const categoryItems = live.filter((m) => m.categoryId === categoryId).length;
  const unavailable = live.filter((m) => !m.available).length;
  const blank = (): MenuItem => ({
    id: `m${Date.now().toString(36)}`,
    categoryId,
    name: "",
    shortCode: "",
    pricePaise: 0,
    veg: true,
    available: true,
    deleted: false,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 px-6 pb-3 pt-5">
        <div>
          <div className="text-label-sm uppercase text-primary">Admin · menu</div>
          <h1 className="flex items-center gap-3 text-headline-lg">
            Menu management
            <span className="flex items-center gap-1.5 rounded-full bg-[#dcfce7] px-3 py-1 text-label-md text-tertiary">
              <span className="h-2 w-2 rounded-full bg-tertiary" /> {live.length} items · {unavailable} unavailable
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <SearchInput className="w-[340px]" value={query} onChange={setQuery} placeholder="Search all items by name or code…" />
          <Button variant="primary" icon="add" onClick={() => setEditing(blank())}>
            Add item
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-4 px-6 pb-5">
        <Card className="flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-headline-sm">Categories</h2>
              <p className="text-body-sm text-muted">{categories.length} categories</p>
            </div>
            <Button size="sm" variant="soft" icon="add" onClick={() => setNewCat("")}>
              Category
            </Button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto">
            {categories.map((c) => {
              const active = c.id === categoryId && !query;
              const count = live.filter((m) => m.categoryId === c.id).length;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(c.id);
                    setQuery("");
                  }}
                  className={cx(
                    "flex h-14 w-full items-center gap-3 rounded-xl border-2 px-3 text-left transition-colors",
                    active ? "border-primary-container bg-primary-fixed" : "border-transparent bg-surface-low hover:bg-surface-high",
                  )}
                >
                  <span className={cx("flex-1 text-label-lg", active && "text-on-primary-fixed")}>{c.name}</span>
                  <span className={cx("tnum rounded-full px-2 py-0.5 text-label-sm", active ? "bg-primary text-white" : "bg-surface-container")}>{count}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="text-headline-md">{query ? `Results for “${query}”` : category?.name}</h2>
              <p className="text-body-md text-muted">{items.length} items · toggle availability when a dish runs out</p>
            </div>
            {!query && category && (
              <div className="flex gap-2">
                <Button size="sm" variant="soft" icon="edit" onClick={() => setRenaming(category.name)}>
                  Rename
                </Button>
                <Button size="sm" variant="ghost" icon="delete" className="text-error! hover:bg-error-container!" onClick={() => setRemovingCat(true)}>
                  Remove
                </Button>
              </div>
            )}
          </div>
          <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {items.length === 0 && (
              <EmptyState icon="restaurant_menu" title="No items here yet">
                Use “Add item” to put a dish in this category.
              </EmptyState>
            )}
            {items.map((m) => (
              <div
                key={m.id}
                className={cx(
                  "flex items-center gap-4 rounded-2xl border bg-surface-lowest px-4 py-3 transition-colors",
                  editing?.id === m.id ? "border-primary ring-2 ring-primary/20" : "border-line",
                  !m.available && "bg-surface-low",
                )}
              >
                <VegMark veg={m.veg} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cx("truncate text-headline-sm", !m.available && "text-muted line-through")}>{m.name}</span>
                    <span className="rounded bg-primary-fixed px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary">{m.shortCode}</span>
                  </div>
                  <div className="text-body-sm text-muted">{state.categories.find((c) => c.id === m.categoryId)?.name}</div>
                </div>
                <div className="w-28 text-right">
                  <div className={cx("tnum text-price-lg", !m.available && "text-muted")}>{formatINRShort(m.pricePaise)}</div>
                  {!m.available && <Badge tone="danger">Unavailable</Badge>}
                </div>
                <Toggle checked={m.available} onChange={() => dispatch({ type: "toggleAvailable", itemId: m.id })} label={`${m.name} available`} />
                <button
                  type="button"
                  aria-label={`Edit ${m.name}`}
                  onClick={() => setEditing(m)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-container hover:bg-primary-fixed hover:text-primary"
                >
                  <Icon name="edit" className="text-[20px]" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${m.name}`}
                  onClick={() => setDeleting(m)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-error-container hover:text-error"
                >
                  <Icon name="delete" className="text-[20px]" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {editing && <ItemEditor key={editing.id} item={editing} onClose={() => setEditing(null)} />}

      <Modal open={!!deleting} onClose={() => setDeleting(null)} className="max-w-md" labelledBy="del-title">
        <div className="p-6">
          <h2 id="del-title" className="text-headline-md">
            Remove {deleting?.name}?
          </h2>
          <p className="mt-2 text-body-md text-muted">
            It leaves the menu straight away. Past bills keep the item name and price they were billed with.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep item
            </Button>
            <Button
              variant="danger"
              icon="delete"
              onClick={() => {
                if (deleting) dispatch({ type: "deleteItem", itemId: deleting.id });
                setDeleting(null);
              }}
            >
              Remove from menu
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={renaming !== null} onClose={() => setRenaming(null)} className="max-w-md" labelledBy="ren-title">
        <div className="space-y-4 p-6">
          <h2 id="ren-title" className="text-headline-md">
            Rename category
          </h2>
          <input autoFocus value={renaming ?? ""} onChange={(e) => setRenaming(e.target.value)} className={inputClass} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!renaming?.trim()}
              onClick={() => {
                if (category && renaming?.trim()) dispatch({ type: "upsertCategory", category: { ...category, name: renaming.trim() } });
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={removingCat} onClose={() => setRemovingCat(false)} className="max-w-md" labelledBy="rem-title">
        <div className="p-6">
          <h2 id="rem-title" className="text-headline-md">
            Remove {category?.name}?
          </h2>
          {categoryItems > 0 ? (
            <p className="mt-2 text-body-md text-muted">
              This category still has {categoryItems} {categoryItems === 1 ? "item" : "items"}. Move or remove them first, then try again.
            </p>
          ) : (
            <p className="mt-2 text-body-md text-muted">It disappears from the menu. Past bills are not affected.</p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRemovingCat(false)}>
              {categoryItems > 0 ? "OK" : "Keep category"}
            </Button>
            {categoryItems === 0 && category && (
              <Button
                variant="danger"
                icon="delete"
                onClick={() => {
                  dispatch({ type: "upsertCategory", category: { ...category, active: false } });
                  setRemovingCat(false);
                }}
              >
                Remove category
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={newCat !== null} onClose={() => setNewCat(null)} className="max-w-md" labelledBy="cat-title">
        <div className="space-y-4 p-6">
          <h2 id="cat-title" className="text-headline-md">
            New category
          </h2>
          <input autoFocus value={newCat ?? ""} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. Chinese" className={inputClass} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setNewCat(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newCat?.trim()}
              onClick={() => {
                dispatch({ type: "addCategory", name: newCat!.trim() });
                setNewCat(null);
              }}
            >
              Add category
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ItemEditor({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const { state, dispatch, categories } = usePos();
  const isNew = !state.menu.some((m) => m.id === item.id);
  const [name, setName] = useState(item.name);
  const [code, setCode] = useState(item.shortCode);
  const [categoryId, setCategoryId] = useState(item.categoryId);
  const [price, setPrice] = useState(item.pricePaise ? String(item.pricePaise / 100) : "");
  const [veg, setVeg] = useState(item.veg ? "veg" : "nonveg");
  const [available, setAvailable] = useState(item.available);
  const codeTaken = state.menu.some((m) => m.id !== item.id && !m.deleted && m.shortCode.toUpperCase() === code.trim().toUpperCase());
  const valid = name.trim() && code.trim() && !codeTaken && rupeesToPaise(price) > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-charcoal/30" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby="edit-title" className="absolute right-0 top-0 flex h-full w-[460px] flex-col rounded-l-3xl bg-surface-lowest shadow-level3">
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-fixed text-primary">
            <Icon name={isNew ? "add_circle" : "edit_note"} />
          </span>
          <div className="flex-1">
            <h2 id="edit-title" className="text-headline-md">
              {isNew ? "Add item" : "Edit item"}
            </h2>
            {!isNew && <p className="font-mono text-label-md text-primary">{item.shortCode}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-high">
            <Icon name="close" />
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-6">
          <Field label="Item name *" hint="Printed on bill & KOT">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Paneer Butter Masala" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Short code *" hint={codeTaken ? <span className="text-error">Already used</span> : "For quick search"}>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} className={cx(inputClass, "font-mono", codeTaken && "ring-2 ring-error")} placeholder="PBM" />
            </Field>
            <Field label="Price (₹) *">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-body-lg text-muted">₹</span>
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className={cx(inputClass, "tnum pl-9")} placeholder="0.00" />
              </div>
            </Field>
          </div>
          {!isNew && rupeesToPaise(price) !== item.pricePaise && rupeesToPaise(price) > 0 && (
            <p className="-mt-2 rounded-lg bg-hold-surface px-3 py-2 text-body-sm text-hold-ink">
              New price applies to new bills. Past bills keep {formatINRShort(item.pricePaise)}.
            </p>
          )}
          <div>
            <div className="mb-2 text-label-lg">Category</div>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
                  className={cx(
                    "h-10 rounded-full px-4 text-label-md transition-colors",
                    categoryId === c.id ? "bg-primary-container text-white" : "border border-line bg-surface-lowest text-ink-variant hover:bg-surface-low",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-label-lg">Food type (FSSAI)</div>
            <Segmented
              value={veg}
              onChange={setVeg}
              options={[
                { value: "veg", label: <span className="flex items-center gap-2"><VegMark veg /> Veg</span> },
                { value: "nonveg", label: <span className="flex items-center gap-2"><VegMark veg={false} /> Non-veg</span> },
              ]}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
            <div>
              <div className="text-label-lg">Available for billing</div>
              <div className="text-body-sm text-muted">Turn off when the dish runs out</div>
            </div>
            <Toggle checked={available} onChange={setAvailable} label="Available for billing" />
          </div>
        </div>

        <div className="flex gap-3 border-t border-line p-4">
          <Button variant="secondary" className="flex-1" onClick={onClose} kbd="Esc">
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-[2]"
            icon="check_circle"
            disabled={!valid}
            onClick={() => {
              dispatch({
                type: "upsertItem",
                item: { ...item, name: name.trim(), shortCode: code.trim().toUpperCase(), categoryId, pricePaise: rupeesToPaise(price), veg: veg === "veg", available },
              });
              onClose();
            }}
          >
            {isNew ? "Add to menu" : "Save changes"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

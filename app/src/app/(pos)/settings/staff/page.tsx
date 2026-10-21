"use client";

import { useState } from "react";
import { SettingsSection } from "@/components/settings-ui";
import { RoleBadge, StaffAvatar } from "@/components/shell";
import { Button, Card, Field, Icon, Modal, Segmented, Toggle, cx, inputClass } from "@/components/ui";
import { usePos } from "@/lib/pos-store";
import type { Role, Staff } from "@/lib/types";

// What each role can do (PRD §4, TRD §6)
const PERMISSIONS: { what: string; detail: string; admin: boolean; cashier: boolean | string }[] = [
  { what: "Create, hold and settle bills", detail: "Cash, UPI and card", admin: true, cashier: true },
  { what: "Print KOT and reprint bills", detail: "Reprints are marked DUPLICATE", admin: true, cashier: true },
  { what: "View bill history", detail: "Search and view bill details", admin: true, cashier: "Today only" },
  { what: "Cancel a paid bill", detail: "Kept for audit with a reason", admin: true, cashier: false },
  { what: "Dashboard & reports", detail: "Sales, payments, items, tax", admin: true, cashier: false },
  { what: "Menu & prices", detail: "Add, edit, mark unavailable", admin: true, cashier: false },
  { what: "Settings, staff & backup", detail: "Profile, GST, receipt, PINs", admin: true, cashier: false },
];

export default function StaffSettingsPage() {
  const { state, dispatch, user } = usePos();
  const [editing, setEditing] = useState<Staff | null>(null);
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const activeAdmins = state.staff.filter((s) => s.role === "admin" && s.active).length;

  return (
    <div className="space-y-4">
      <SettingsSection
        icon="badge"
        title="Staff & roles"
        subtitle={`${state.staff.filter((s) => s.active).length} active · staff log in with a 4-digit PIN`}
        actions={
          <Button
            variant="primary"
            icon="person_add"
            onClick={() => setEditing({ id: `s${Date.now().toString(36)}`, name: "", role: "cashier", pin: "", phone: "", active: true })}
          >
            Add staff
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {state.staff.map((s) => {
            const lastAdmin = s.role === "admin" && s.active && activeAdmins === 1;
            return (
              <Card key={s.id} className={cx("p-4", !s.active && "bg-surface-low opacity-70")}>
                <div className="flex items-start gap-3">
                  <StaffAvatar name={s.name} size={48} className={s.active ? "" : "bg-surface-container text-muted"} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-headline-sm">{s.name}</div>
                    <div className="text-body-sm text-muted">{s.phone || "No phone"}</div>
                  </div>
                  <RoleBadge role={s.role} />
                </div>
                <div className="mt-3 rounded-lg bg-surface-low px-3 py-2 text-body-sm text-muted">
                  PIN <span className="font-mono tracking-widest text-ink">••••</span>
                  {s.id === user?.id && <span className="ml-2 font-semibold text-tertiary">· you</span>}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-label-md">
                    <Toggle
                      checked={s.active}
                      disabled={lastAdmin || s.id === user?.id}
                      onChange={(v) => dispatch({ type: "upsertStaff", staff: { ...s, active: v } })}
                      label={`${s.name} active`}
                    />
                    {s.active ? "Active" : "Inactive"}
                  </span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="soft" icon="pin" onClick={() => setPinFor(s)}>
                      Reset PIN
                    </Button>
                    <button type="button" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-high">
                      <Icon name="edit" className="text-[18px]" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection icon="shield_person" title="What each role can do" subtitle="Two roles keep it simple: Admin and Cashier">
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left">
            <thead className="bg-surface-low text-label-md uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-charcoal" /> Admin</span>
                </th>
                <th className="px-4 py-3">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary-container" /> Cashier</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-low">
              {PERMISSIONS.map((p) => (
                <tr key={p.what}>
                  <td className="px-4 py-3">
                    <div className="text-label-lg">{p.what}</div>
                    <div className="text-body-sm text-muted">{p.detail}</div>
                  </td>
                  <td className="px-4 py-3"><Allowed v={p.admin} /></td>
                  <td className="px-4 py-3"><Allowed v={p.cashier} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      {editing && <StaffEditor key={editing.id} staff={editing} onClose={() => setEditing(null)} />}
      {pinFor && <PinReset key={pinFor.id} staff={pinFor} onClose={() => setPinFor(null)} />}
    </div>
  );
}

function Allowed({ v }: { v: boolean | string }) {
  if (v === true)
    return (
      <span className="flex items-center gap-1.5 text-label-lg text-tertiary">
        <Icon name="check_circle" className="text-[20px]" /> Allowed
      </span>
    );
  if (v === false)
    return (
      <span className="flex items-center gap-1.5 text-label-lg text-muted">
        <Icon name="block" className="text-[20px]" /> No access
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-label-lg text-hold-ink">
      <Icon name="schedule" className="text-[20px]" /> {v}
    </span>
  );
}

function StaffEditor({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { state, dispatch } = usePos();
  const isNew = !state.staff.some((s) => s.id === staff.id);
  const [name, setName] = useState(staff.name);
  const [phone, setPhone] = useState(staff.phone);
  const [role, setRole] = useState<Role>(staff.role);
  const [pin, setPin] = useState("");
  const valid = name.trim() && (!isNew || /^\d{4}$/.test(pin));

  return (
    <Modal open onClose={onClose} className="max-w-lg" labelledBy="staff-title">
      <div className="space-y-5 p-6">
        <h2 id="staff-title" className="text-headline-md">
          {isNew ? "Add staff" : `Edit ${staff.name}`}
        </h2>
        <Field label="Full name *">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Phone" hint="Optional">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>
        <div>
          <div className="mb-2 text-label-lg">Role</div>
          <Segmented<Role>
            value={role}
            onChange={setRole}
            options={[
              { value: "cashier", label: "Cashier", icon: "point_of_sale" },
              { value: "admin", label: "Admin", icon: "admin_panel_settings" },
            ]}
          />
        </div>
        {isNew && (
          <Field label="4-digit PIN *" hint="They can't see it later">
            <input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${inputClass} font-mono tracking-[0.5em]`} />
          </Field>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              dispatch({ type: "upsertStaff", staff: { ...staff, name: name.trim(), phone, role, pin: isNew ? pin : staff.pin } });
              onClose();
            }}
          >
            {isNew ? "Add staff" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PinReset({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { dispatch } = usePos();
  const [pin, setPin] = useState("");
  return (
    <Modal open onClose={onClose} className="max-w-sm" labelledBy="pin-title">
      <div className="space-y-5 p-6">
        <h2 id="pin-title" className="text-headline-md">
          New PIN for {staff.name.split(" ")[0]}
        </h2>
        <input
          autoFocus
          inputMode="numeric"
          aria-label="New 4-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className={`${inputClass} text-center font-mono text-[24px] tracking-[0.6em]`}
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={pin.length !== 4}
            onClick={() => {
              dispatch({ type: "upsertStaff", staff: { ...staff, pin } });
              onClose();
            }}
          >
            Set PIN
          </Button>
        </div>
      </div>
    </Modal>
  );
}

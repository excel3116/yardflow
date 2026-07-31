import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Truck, Scale, PackageCheck, ShieldCheck, LogOut, Plus, X, Search,
  Clock, ChevronRight, AlertTriangle, CheckCircle2, Warehouse, ClipboardList,
  BarChart3, Gauge, Radio, ArrowRight, Filter, User, Wifi, WifiOff,
  RotateCcw, Sparkles, MousePointerClick, Layers, CircleDot, Circle
} from "lucide-react";
import { supabase } from "./supabaseClient";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLES = ["Vendor", "Security", "Yard Supervisor", "Yard Incharge", "QC", "Admin"];

const VENDORS = ["Bajaj", "Tata Motors", "Mahindra", "GE"];
const TRANSPORTERS = ["Self / Own Vehicle", "Balaji Transport", "Shree Ram Transport"];
const MATERIALS = ["Copper", "Stainless Steel", "Scrap", "Aluminium", "CRC"];
const DESTINATIONS = ["MTC Nanekarwadi", "MTC Kharabwadi", "MTC Talawade"];
const YARDS = ["Yard A - Slot 1", "Yard A - Slot 2", "Yard B - Slot 5", "Yard B - Slot 6", "Yard C - Slot 3"];

// Lifecycle: Expected -> Departed -> Arrived -> (Yard Assigned) -> First Weighment -> Unloading -> Unloaded -> Exited -> Completed | Refill Pending
const WAITING_STAGES = ["Expected", "Departed", "Reported", "Approved for Entry", "Arrived", "Yard Assigned", "First Weighment", "Unloading", "Unloaded", "Exited"];

// Which role(s) can act on a vehicle at each status, and what that action does.
// type: "advance" (simple move to next status), "assignYard", "firstWeigh", "secondWeigh", "exitApprove", "finalize"
const STATUS_ACTIONS = {
  Expected: [
    { role: "Vendor", label: "Mark Left MTC", icon: Truck, type: "advance", next: "Departed" },
  ],
  Departed: [
    { role: "Security", label: "Report", icon: ShieldCheck, type: "advance", next: "Reported", noFlag: true },
  ],
  Reported: [
    { role: "Yard Supervisor", label: "Approve Entry", icon: Warehouse, type: "advance", next: "Approved for Entry", noFlag: true },
  ],
  "Approved for Entry": [
    { role: "Security", label: "Allow Inside", icon: ShieldCheck, type: "advance", next: "Arrived", noFlag: true },
  ],
  Arrived: [
    { role: "Yard Incharge", label: "Assign Yard", icon: Warehouse, type: "assignYard", next: "Yard Assigned" },
    { role: "Yard Incharge", label: "Send for First Weighment", icon: Scale, type: "firstWeigh", next: "First Weighment" },
  ],
  "Yard Assigned": [
    { role: "Yard Incharge", label: "Send for First Weighment", icon: Scale, type: "firstWeigh", next: "First Weighment" },
  ],
  "First Weighment": [
    { role: "Yard Incharge", label: "Send for Unloading", icon: PackageCheck, type: "advance", next: "Unloading" },
  ],
  Unloading: [
    { role: "Yard Incharge", label: "Take Second Weighment", icon: Scale, type: "secondWeigh", next: "Unloaded" },
  ],
  Unloaded: [
    { role: "Security", label: "Approve Exit", icon: LogOut, type: "exitApprove", approverKey: "securityExitApproved", approverLabel: "Security" },
    { role: "Yard Supervisor", label: "Mark Work Done", icon: LogOut, type: "exitApprove", approverKey: "yardExitApproved", approverLabel: "Yard Supervisor" },
    { role: "Yard Supervisor", label: "Send for Refill", icon: RotateCcw, type: "finalize", outcome: "Refill Pending" },
  ],
  Exited: [
    { role: "QC", label: "Mark Completed", icon: CheckCircle2, type: "finalize", outcome: "Completed", noFlag: true },
    { role: "QC", label: "Flag Quality Issue", icon: AlertTriangle, type: "qcFlag", noFlag: true },
  ],
};

function actionsFor(vehicle, role) {
  const list = STATUS_ACTIONS[vehicle.status] || [];
  return list.filter((a) => {
    if (role !== "Admin" && a.role !== role) return false;
    if (a.type === "exitApprove" && vehicle[a.approverKey]) return false; // already approved by that role
    return true;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function minutesAgo(mins) { return Date.now() - mins * 60 * 1000; }

function randomVehicleNo() {
  const states = ["MH", "GJ", "RJ", "UP", "MP"];
  const s = states[randomBetween(0, states.length - 1)];
  const num1 = randomBetween(10, 99);
  const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const num2 = randomBetween(1000, 9999);
  return `${s}${num1}${letters}${num2}`;
}

function formatElapsed(ms) {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatClock(ts) { return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }
function formatDateTime(ts) { return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function dayKey(ts) { return new Date(ts).toLocaleDateString("en-CA"); }
function formatDayLabel(key) { return new Date(`${key}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

function statusColor(status) {
  if (status === "Expected") return { fg: "#8A93A3", bg: "#1A2029", bd: "#2A323D" };
  if (status === "Completed") return { fg: "#3ECF8E", bg: "#122A22", bd: "#1E4A3A" };
  if (status === "Refill Pending") return { fg: "#B98CF5", bg: "#241A2E", bd: "#3E2A4A" };
  if (WAITING_STAGES.includes(status)) return { fg: "#F2A93B", bg: "#2A2015", bd: "#4A3A1E" };
  return { fg: "#4C8CF5", bg: "#122238", bd: "#1E3A5C" };
}

// ---------------------------------------------------------------------------
// Row <-> app object mapping
// ---------------------------------------------------------------------------

function rowToVehicle(row) {
  return {
    id: row.id,
    vehicleNumber: row.vehicle_number,
    driver: row.driver,
    mobile: row.mobile,
    vendor: row.vendor,
    transporter: row.transporter,
    material: row.material,
    po: row.po,
    invoiceNo: row.invoice_no,
    destination: row.destination,
    status: row.status,
    statusAt: row.status_at ? new Date(row.status_at).getTime() : Date.now(),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    yard: row.yard,
    partyNetWeight: row.party_net_weight,
    grossWeight: row.gross_weight,
    tareWeight: row.tare_weight,
    netWeight: row.net_weight,
    securityExitApproved: row.security_exit_approved || false,
    yardExitApproved: row.yard_exit_approved || false,
    history: row.history || [],
    flagged: row.flagged || false,
    flagReason: row.flag_reason || "",
    flaggedAt: row.flagged_at ? new Date(row.flagged_at).getTime() : null,
  };
}

function buildSeedRows() {
  const seed = (mins, status, extra = {}) => {
    const at = minutesAgo(mins);
    return {
      vehicle_number: randomVehicleNo(),
      driver: "Ramesh Yadav",
      mobile: "98" + randomBetween(10000000, 99999999),
      vendor: VENDORS[randomBetween(0, VENDORS.length - 1)],
      transporter: TRANSPORTERS[randomBetween(0, TRANSPORTERS.length - 1)],
      material: MATERIALS[randomBetween(0, MATERIALS.length - 1)],
      po: "PO-" + randomBetween(10000, 99999),
      invoice_no: "INV-" + randomBetween(10000, 99999),
      destination: DESTINATIONS[randomBetween(0, DESTINATIONS.length - 1)],
      party_net_weight: randomBetween(19000, 21000),
      status,
      status_at: new Date(at).toISOString(),
      history: [{ status, at }],
      ...extra,
    };
  };

  return [
    seed(5, "Expected"),
    seed(20, "Expected"),
    seed(65, "Arrived", {}),
    seed(80, "Yard Assigned", { yard: YARDS[0] }),
    seed(40, "Unloaded", { yard: YARDS[1], gross_weight: 30200, tare_weight: 9600, net_weight: 20600, security_exit_approved: true }),
    seed(15, "Exited", { yard: YARDS[2], gross_weight: 29800, tare_weight: 9500, net_weight: 20300, security_exit_approved: true, yard_exit_approved: true }),
    seed(200, "Completed", { yard: YARDS[3], gross_weight: 31000, tare_weight: 9900, net_weight: 21100, security_exit_approved: true, yard_exit_approved: true }),
    seed(300, "Refill Pending", { yard: YARDS[4], gross_weight: 28500, tare_weight: 9400, net_weight: 19100, security_exit_approved: true, yard_exit_approved: true }),
  ];
}

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

function Pill({ children, fg, bg, bd }) {
  return (
    <span style={{ color: fg, backgroundColor: bg, borderColor: bd }}
      className="inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
      {children}
    </span>
  );
}

function StatCard({ card, count, active, onClick }) {
  const Icon = card.icon;
  return (
    <button onClick={onClick}
      className={`text-left rounded-[6px] border px-4 py-3 transition-colors ${active ? "border-[#4C8CF5] bg-[#122238]" : "border-[#242B34] bg-[#161B22] hover:border-[#323B47]"}`}>
      <div className="flex items-center justify-between mb-2">
        <Icon size={16} className="text-[#6B7686]" />
        {card.pulse && <Radio size={10} className="text-[#F2A93B] animate-pulse" />}
      </div>
      <div className="font-[Barlow_Condensed] text-[28px] leading-none font-bold text-[#EDF1F5] tabular-nums">{count}</div>
      <div className="text-[11px] text-[#8A93A3] mt-1.5 leading-tight">{card.label}</div>
    </button>
  );
}

const DASHBOARD_CARDS = [
  { key: "Expected", label: "Awaiting departure (MTC)", icon: Clock, filter: (v) => v.status === "Expected", pulse: true },
  { key: "DepartedWait", label: "Awaiting gate report", icon: Truck, filter: (v) => v.status === "Departed", pulse: true },
  { key: "Inside", label: "Inside plant", icon: Truck, filter: (v) => !["Expected", "Departed", "Completed", "Refill Pending"].includes(v.status) },
  { key: "ReportWait", label: "Awaiting yard approval", icon: Warehouse, filter: (v) => v.status === "Reported", pulse: true },
  { key: "AllowWait", label: "Awaiting security allow-in", icon: ShieldCheck, filter: (v) => v.status === "Approved for Entry", pulse: true },
  { key: "YardWait", label: "Awaiting yard / first weighment", icon: Warehouse, filter: (v) => v.status === "Arrived" },
  { key: "FirstWeighWait", label: "Awaiting first weighment", icon: Scale, filter: (v) => v.status === "Yard Assigned", pulse: true },
  { key: "UnloadWait", label: "Awaiting unloading", icon: PackageCheck, filter: (v) => v.status === "First Weighment", pulse: true },
  { key: "Unloading", label: "Awaiting second weighment", icon: Scale, filter: (v) => v.status === "Unloading", pulse: true },
  { key: "WeighmentDone", label: "Weighment finished", icon: Scale, filter: (v) => v.netWeight != null },
  { key: "ExitWait", label: "Awaiting exit approval", icon: LogOut, filter: (v) => v.status === "Unloaded", pulse: true },
  { key: "QCPending", label: "Awaiting QC decision", icon: ClipboardList, filter: (v) => v.status === "Exited" },
  { key: "Completed", label: "Completed today", icon: CheckCircle2, filter: (v) => v.status === "Completed" },
  { key: "Refill", label: "Refill pending", icon: RotateCcw, filter: (v) => v.status === "Refill Pending" },
  { key: "Delayed", label: "Flagged / delayed", icon: AlertTriangle, filter: (v) => v.flagged && !["Completed", "Refill Pending"].includes(v.status) },
];

function AddVehicleModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    vehicleNumber: "", driver: "", mobile: "", vendor: VENDORS[0], transporter: TRANSPORTERS[0],
    material: MATERIALS[0], po: "", invoiceNo: "", destination: DESTINATIONS[0], partyNetWeight: "",
  });
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e) => { e.preventDefault(); if (!form.vehicleNumber.trim()) return; onCreate(form); };
  const inputCls = "w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm focus:outline-none focus:border-[#4C8CF5]";
  const labelCls = "block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 overflow-y-auto">
      <form onSubmit={submit} className="w-full max-w-md rounded-[8px] border border-[#2A323D] bg-[#14181E] p-5 shadow-2xl my-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-[Barlow_Condensed] text-[20px] font-bold text-[#EDF1F5] tracking-wide">New vehicle entry</h3>
          <button type="button" onClick={onClose} className="text-[#6B7686] hover:text-[#EDF1F5]"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Vehicle number *</label>
            <input autoFocus value={form.vehicleNumber} onChange={update("vehicleNumber")} placeholder="MH12AB1234" className={`${inputCls} font-mono`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Driver name</label>
              <input value={form.driver} onChange={update("driver")} placeholder="Ramesh Yadav" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Mobile</label>
              <input value={form.mobile} onChange={update("mobile")} placeholder="9812345678" className={`${inputCls} font-mono`} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Vendor</label>
              <select value={form.vendor} onChange={update("vendor")} className={inputCls}>
                {VENDORS.map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Transporter</label>
              <select value={form.transporter} onChange={update("transporter")} className={inputCls}>
                {TRANSPORTERS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Material</label>
              <select value={form.material} onChange={update("material")} className={inputCls}>
                {MATERIALS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Destination</label>
              <select value={form.destination} onChange={update("destination")} className={inputCls}>
                {DESTINATIONS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>PO number</label>
              <input value={form.po} onChange={update("po")} placeholder="PO-48213" className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>Invoice no.</label>
              <input value={form.invoiceNo} onChange={update("invoiceNo")} placeholder="INV-90214" className={`${inputCls} font-mono`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Party net weight (kg)</label>
            <input type="number" value={form.partyNetWeight} onChange={update("partyNetWeight")} placeholder="As per party's invoice" className={`${inputCls} font-mono`} />
            <div className="text-[10px] text-[#5A6270] mt-1">Declared weight from the vendor's own paperwork — compared later against our measured weight.</div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="flex-1 rounded-[4px] border border-[#2A323D] py-2 text-sm text-[#8A93A3] hover:text-[#EDF1F5] hover:border-[#3A4451] transition-colors">Cancel</button>
          <button type="submit" className="flex-1 rounded-[4px] bg-[#4C8CF5] py-2 text-sm font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors">Create trip</button>
        </div>
      </form>
    </div>
  );
}

function WeighInModal({ request, onClose, onSubmit }) {
  const [value, setValue] = useState("");
  if (!request) return null;
  const isFirst = request.action.type === "firstWeigh";
  const num = Number(value);
  const valid = value !== "" && !Number.isNaN(num) && num > 0;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit(num);
    setValue("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-[8px] border border-[#2A323D] bg-[#14181E] p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-[Barlow_Condensed] text-[20px] font-bold text-[#EDF1F5] tracking-wide">
            {isFirst ? "First weighment" : "Second weighment"}
          </h3>
          <button type="button" onClick={onClose} className="text-[#6B7686] hover:text-[#EDF1F5]"><X size={18} /></button>
        </div>
        <div className="text-[12px] text-[#8A93A3] mb-4 font-mono">
          {request.vehicle.vehicleNumber} · {isFirst ? "loaded (gross) weight" : "empty (tare) weight after unloading"}
        </div>
        <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">Weight (kg)</label>
        <input autoFocus type="number" min="0" step="1" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 30200"
          className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm font-mono focus:outline-none focus:border-[#4C8CF5]" />
        {!isFirst && valid && request.vehicle.grossWeight != null && (
          <div className="text-[11px] text-[#6B7686] mt-2">
            Net weight will be recorded as{" "}
            <span className="text-[#DCE2E8] font-mono">{(request.vehicle.grossWeight - num).toLocaleString("en-IN")} kg</span>
          </div>
        )}
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="flex-1 rounded-[4px] border border-[#2A323D] py-2 text-sm text-[#8A93A3] hover:text-[#EDF1F5] hover:border-[#3A4451] transition-colors">Cancel</button>
          <button type="submit" disabled={!valid} className="flex-1 rounded-[4px] bg-[#4C8CF5] py-2 text-sm font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors disabled:opacity-50">Record weight</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#5A6270]">{label}</div>
      <div className={`text-[#DCE2E8] ${mono ? "font-mono text-[12px]" : ""}`}>{value || "—"}</div>
    </div>
  );
}

function WeightReadout({ label, value, highlight, warn }) {
  return (
    <div className={`rounded-[4px] border px-2 py-2 text-center ${highlight ? "border-[#3ECF8E] bg-[#122A22]" : warn ? "border-[#4A1E1E] bg-[#2A1515]" : "border-[#2A323D] bg-[#1C222A]"}`}>
      <div className="text-[9px] uppercase tracking-wide text-[#6B7686]">{label}</div>
      <div className={`font-mono text-[13px] font-bold tabular-nums ${highlight ? "text-[#3ECF8E]" : warn ? "text-[#FF5C5C]" : "text-[#DCE2E8]"}`}>
        {value != null ? value.toLocaleString("en-IN") : "—"}
      </div>
      <div className="text-[8px] text-[#5A6270]">kg</div>
    </div>
  );
}

function ExitApprovalRow({ vehicle }) {
  if (vehicle.status !== "Unloaded" && vehicle.status !== "Exited") return null;
  const secDone = vehicle.securityExitApproved || vehicle.status === "Exited";
  const yardDone = vehicle.yardExitApproved || vehicle.status === "Exited";
  return (
    <div className="flex items-center gap-4 text-[12px] mb-3">
      <div className="flex items-center gap-1.5">
        {secDone ? <CheckCircle2 size={13} className="text-[#3ECF8E]" /> : <Circle size={13} className="text-[#5A6270]" />}
        <span className={secDone ? "text-[#8A93A3]" : "text-[#5A6270]"}>Security exit approval</span>
      </div>
      <div className="flex items-center gap-1.5">
        {yardDone ? <CheckCircle2 size={13} className="text-[#3ECF8E]" /> : <Circle size={13} className="text-[#5A6270]" />}
        <span className={yardDone ? "text-[#8A93A3]" : "text-[#5A6270]"}>Yard supervisor approval</span>
      </div>
    </div>
  );
}

function ActionButtons({ vehicle, role, onAdvance, onFlag, onClearFlag, compact }) {
  const actions = actionsFor(vehicle, role);
  const flagAllowed = actions.length > 0 && !actions.every((a) => a.noFlag);
  if (actions.length === 0 && !vehicle.flagged) return compact ? <span className="text-[11px] text-[#5A6270]">No action pending</span> : null;

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${compact ? "justify-end" : ""}`}>
      {actions.map((a, i) => (
        <button key={i} onClick={(e) => { e.stopPropagation(); if (a.type === "qcFlag") onFlag(vehicle); else onAdvance(vehicle, a); }}
          className={`inline-flex items-center gap-1 rounded-[4px] border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            a.type === "qcFlag"
              ? "border-[#4A1E1E] bg-[#2A1515] text-[#FF5C5C] hover:bg-[#331A1A]"
              : a.type === "finalize" && a.outcome === "Refill Pending"
              ? "border-[#3E2A4A] bg-[#241A2E] text-[#C9A0F5] hover:bg-[#2E2138]"
              : "border-[#3A5A8C] bg-[#122238] text-[#7CACF8] hover:bg-[#183155]"
          }`}>
          <a.icon size={12} />{a.label}{a.type === "exitApprove" ? ` (${a.approverLabel})` : ""}
        </button>
      ))}
      {flagAllowed && (
        vehicle.flagged ? (
          <button onClick={(e) => { e.stopPropagation(); onClearFlag(vehicle); }} title="Clear the delayed flag"
            className="inline-flex items-center gap-1 rounded-[4px] border border-[#2A323D] px-2 py-1.5 text-[11px] text-[#8A93A3] hover:text-[#EDF1F5] transition-colors">
            <RotateCcw size={11} /> Clear
          </button>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); onFlag(vehicle); }} title="Mark as not reached / not done yet"
            className="inline-flex items-center gap-1 rounded-[4px] border border-[#2A323D] px-2 py-1.5 text-[11px] text-[#8A93A3] hover:text-[#F2A93B] hover:border-[#4A3A1E] transition-colors">
            <AlertTriangle size={11} /> Not yet
          </button>
        )
      )}
    </div>
  );
}

function DetailDrawer({ vehicle, role, onClose, onAdvance, onFlag, onClearFlag }) {
  if (!vehicle) return null;
  const sc = statusColor(vehicle.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="w-full max-w-md h-full bg-[#12161C] border-l border-[#242B34] overflow-y-auto">
        <div className="sticky top-0 bg-[#12161C] border-b border-[#242B34] px-5 py-4 flex items-center justify-between">
          <div>
            <div className="font-mono text-[20px] font-bold text-[#EDF1F5] tracking-wider">{vehicle.vehicleNumber}</div>
            <div className="text-[12px] text-[#6B7686]">ID: {vehicle.id}</div>
          </div>
          <button onClick={onClose} className="text-[#6B7686] hover:text-[#EDF1F5]"><X size={20} /></button>
        </div>
        <div className="p-5">
          <div className="relative rounded-[8px] border border-[#242B34] bg-[#161B22] p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <Pill fg={sc.fg} bg={sc.bg} bd={sc.bd}>{vehicle.status}</Pill>
              <span className="text-[11px] text-[#6B7686] font-mono">{formatDateTime(vehicle.statusAt)}</span>
            </div>
            <div className="border-t border-dashed border-[#2A323D] my-3" />
            <div className="grid grid-cols-2 gap-y-2.5 gap-x-3 text-[13px]">
              <Field label="Vendor" value={vehicle.vendor} />
              <Field label="Transporter" value={vehicle.transporter} />
              <Field label="Material" value={vehicle.material} />
              <Field label="Destination" value={vehicle.destination} />
              <Field label="PO number" value={vehicle.po} mono />
              <Field label="Invoice no." value={vehicle.invoiceNo} mono />
              <Field label="Party net weight" value={vehicle.partyNetWeight ? `${vehicle.partyNetWeight.toLocaleString("en-IN")} kg` : null} mono />
              <Field label="Driver" value={vehicle.driver} />
              <Field label="Mobile" value={vehicle.mobile} mono />
              {vehicle.yard && <Field label="Yard slot" value={vehicle.yard} />}
            </div>
          </div>

          {vehicle.flagged && !["Completed", "Refill Pending"].includes(vehicle.status) && (
            <div className="mb-5 rounded-[6px] border border-[#4A1E1E] bg-[#2A1515] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#FF5C5C] mb-0.5">
                <AlertTriangle size={13} /> Flagged
              </div>
              {vehicle.flagReason && <div className="text-[12px] text-[#D9A0A0]">{vehicle.flagReason}</div>}
              {vehicle.flaggedAt && <div className="text-[11px] text-[#8A6060] font-mono mt-0.5">{formatDateTime(vehicle.flaggedAt)}</div>}
            </div>
          )}

          {(vehicle.grossWeight != null || vehicle.tareWeight != null || vehicle.netWeight != null) && (() => {
            const dev = vehicle.netWeight != null && vehicle.partyNetWeight
              ? Math.abs(vehicle.netWeight - vehicle.partyNetWeight) / vehicle.partyNetWeight
              : null;
            return (
              <div className="grid grid-cols-3 gap-2 mb-5">
                <WeightReadout label="Gross (loaded)" value={vehicle.grossWeight} />
                <WeightReadout label="Tare (empty)" value={vehicle.tareWeight} />
                <WeightReadout label="Net weight" value={vehicle.netWeight} highlight={dev != null && dev <= 0.02} warn={dev != null && dev > 0.02} />
              </div>
            );
          })()}

          <ExitApprovalRow vehicle={vehicle} />

          <div className="mb-6">
            <ActionButtons vehicle={vehicle} role={role} onAdvance={onAdvance} onFlag={onFlag} onClearFlag={onClearFlag} />
          </div>

          <div className="text-[11px] uppercase tracking-wide text-[#6B7686] mb-3">Journey timeline</div>
          <div className="space-y-0">
            {(vehicle.history || []).map((h, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-[#4C8CF5] mt-1.5 shrink-0" />
                  {i < vehicle.history.length - 1 && <div className="w-px flex-1 bg-[#2A323D]" />}
                </div>
                <div className="pb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-[13px] text-[#EDF1F5]">{ACTION_LABELS[h.status] || h.status}</div>
                    {h.outcome === "not-approved" && <Pill fg="#FF5C5C" bg="#2A1515" bd="#4A1E1E">Not approved</Pill>}
                  </div>
                  <div className="text-[11px] text-[#6B7686] font-mono">
                    {formatDateTime(h.at)}{h.role ? ` · ${h.role}` : ""}
                  </div>
                  {h.note && <div className="text-[11px] text-[#8A93A3] mt-0.5">{h.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function avgBetween(vehicles, fromStatus, toStatus) {
  const diffs = [];
  vehicles.forEach((v) => {
    const from = (v.history || []).find((h) => h.status === fromStatus);
    const to = (v.history || []).find((h) => h.status === toStatus);
    if (from && to) diffs.push(to.at - from.at);
  });
  if (!diffs.length) return null;
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

function ReportsView({ vehicles }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const inRange = useCallback((ts) => {
    if (fromDate && ts < new Date(fromDate).getTime()) return false;
    if (toDate && ts > new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
    return true;
  }, [fromDate, toDate]);

  const filteredVehicles = useMemo(() => {
    if (!fromDate && !toDate) return vehicles;
    return vehicles.filter((v) => (v.history || []).some((h) => inRange(h.at)));
  }, [vehicles, fromDate, toDate, inRange]);

  const metrics = [
    { label: "Avg. wait for first weighment", value: avgBetween(filteredVehicles, "Arrived", "First Weighment") },
    { label: "Avg. unloading time", value: avgBetween(filteredVehicles, "First Weighment", "Unloaded") },
    { label: "Avg. exit approval time", value: avgBetween(filteredVehicles, "Unloaded", "Exited") },
    { label: "Avg. total turnaround", value: avgBetween(filteredVehicles, "Arrived", "Exited") },
  ];

  const groupBy = (keyFn) => {
    const map = {};
    filteredVehicles.forEach((v) => {
      const key = keyFn(v) || "—";
      map[key] = map[key] || { total: 0, completed: 0, refill: 0, netWeight: 0, group: [] };
      map[key].total += 1;
      if (v.status === "Completed") map[key].completed += 1;
      if (v.status === "Refill Pending") map[key].refill += 1;
      if (v.netWeight) map[key].netWeight += v.netWeight;
      map[key].group.push(v);
    });
    return Object.entries(map)
      .map(([name, s]) => [name, {
        ...s,
        avgFirstWeigh: avgBetween(s.group, "Arrived", "First Weighment"),
        avgUnloading: avgBetween(s.group, "First Weighment", "Unloaded"),
        avgExit: avgBetween(s.group, "Unloaded", "Exited"),
        avgTurnaround: avgBetween(s.group, "Arrived", "Exited"),
      }])
      .sort((a, b) => b[1].total - a[1].total);
  };

  const vendorStats = useMemo(() => groupBy((v) => v.vendor), [filteredVehicles]);
  const transporterStats = useMemo(() => groupBy((v) => v.transporter), [filteredVehicles]);

  const dailyBreakdown = useMemo(() => {
    const map = {};
    vehicles.forEach((v) => {
      (v.history || []).forEach((h) => {
        if (!inRange(h.at)) return;
        const key = dayKey(h.at);
        map[key] = map[key] || { created: 0, departed: 0, completed: 0, refill: 0, flagged: 0, netWeight: 0 };
        if (h.status === "Expected") map[key].created += 1;
        else if (h.status === "Departed") map[key].departed += 1;
        else if (h.status === "Completed") map[key].completed += 1;
        else if (h.status === "Refill Pending") map[key].refill += 1;
        else if (h.status === "Flagged") map[key].flagged += 1;
        else if (h.status === "Unloaded" && v.netWeight != null) map[key].netWeight += v.netWeight;
      });
    });
    const rows = Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
    return fromDate || toDate ? rows : rows.slice(0, 14);
  }, [vehicles, fromDate, toDate, inRange]);

  const inputCls = "rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-2.5 py-1.5 text-[#EDF1F5] text-[12px] font-mono focus:outline-none focus:border-[#4C8CF5]";

  const GroupTable = ({ title, description, rows }) => (
    <div className="mb-6">
      <div className="mb-2">
        <div className="text-[11px] uppercase tracking-wide text-[#6B7686]">{title}</div>
        {description && <div className="text-[11px] text-[#5A6270] mt-0.5">{description}</div>}
      </div>
      <div className="rounded-[6px] border border-[#242B34] overflow-hidden overflow-x-auto">
        <table className="w-full text-[13px] min-w-[900px]">
          <thead>
            <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-right px-4 py-2 font-medium">Total trips</th>
              <th className="text-right px-4 py-2 font-medium">Completed</th>
              <th className="text-right px-4 py-2 font-medium">Refill pending</th>
              <th className="text-right px-4 py-2 font-medium">Total net wt.</th>
              <th className="text-right px-4 py-2 font-medium">Avg. first weigh wait</th>
              <th className="text-right px-4 py-2 font-medium">Avg. unloading time</th>
              <th className="text-right px-4 py-2 font-medium">Avg. exit approval</th>
              <th className="text-right px-4 py-2 font-medium">Avg. turnaround</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, s]) => (
              <tr key={name} className="border-t border-[#242B34]">
                <td className="px-4 py-2.5 text-[#DCE2E8]">{name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#DCE2E8]">{s.total}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#3ECF8E]">{s.completed}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#B98CF5]">{s.refill}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#8A93A3]">{s.netWeight.toLocaleString("en-IN")} kg</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#8A93A3]">{s.avgFirstWeigh != null ? formatElapsed(s.avgFirstWeigh) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#8A93A3]">{s.avgUnloading != null ? formatElapsed(s.avgUnloading) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#8A93A3]">{s.avgExit != null ? formatElapsed(s.avgExit) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#EDF1F5]">{s.avgTurnaround != null ? formatElapsed(s.avgTurnaround) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="font-[Barlow_Condensed] text-[22px] font-bold text-[#EDF1F5] tracking-wide">Reports</div>
          <div className="text-[12px] text-[#8A93A3]">Turnaround times and activity, broken down by day, vendor, and transporter.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] text-[#6B7686] uppercase tracking-wide">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputCls} />
          <label className="text-[11px] text-[#6B7686] uppercase tracking-wide">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(""); setToDate(""); }}
              className="flex items-center gap-1 text-[11px] text-[#8A93A3] hover:text-[#EDF1F5] border border-[#242B34] rounded-[4px] px-2 py-1.5">
              <X size={11} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-[6px] border border-[#242B34] bg-[#161B22] px-4 py-3">
            <div className="font-mono text-[22px] font-bold text-[#EDF1F5] tabular-nums">{m.value != null ? formatElapsed(m.value) : "—"}</div>
            <div className="text-[11px] text-[#8A93A3] mt-1 leading-tight">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-wide text-[#6B7686] mb-2">
          Daily report {!fromDate && !toDate ? "(last 14 days with activity)" : ""}
        </div>
        <div className="rounded-[6px] border border-[#242B34] overflow-hidden overflow-x-auto">
          <table className="w-full text-[13px] min-w-[620px]">
            <thead>
              <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-right px-4 py-2 font-medium">Created</th>
                <th className="text-right px-4 py-2 font-medium">Departed</th>
                <th className="text-right px-4 py-2 font-medium">Completed</th>
                <th className="text-right px-4 py-2 font-medium">Refill</th>
                <th className="text-right px-4 py-2 font-medium">Flagged</th>
                <th className="text-right px-4 py-2 font-medium">Net wt. moved</th>
              </tr>
            </thead>
            <tbody>
              {dailyBreakdown.map(([key, d]) => (
                <tr key={key} className="border-t border-[#242B34]">
                  <td className="px-4 py-2.5 text-[#DCE2E8] font-mono">{formatDayLabel(key)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#DCE2E8]">{d.created}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#DCE2E8]">{d.departed}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#3ECF8E]">{d.completed}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#B98CF5]">{d.refill}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#FF5C5C]">{d.flagged}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#8A93A3]">{d.netWeight.toLocaleString("en-IN")} kg</td>
                </tr>
              ))}
              {dailyBreakdown.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[#5A6270] text-[13px]">No activity in this range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <GroupTable title="Vendor-wise activity" description="Trip counts and average wait/turnaround times for each vendor." rows={vendorStats} />
      <GroupTable title="Transporter-wise activity" description="Trip counts and average wait/turnaround times for each transporter." rows={transporterStats} />
    </div>
  );
}

function WelcomeModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-[10px] border border-[#2A323D] bg-[#14181E] p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-[#4C8CF5]" />
          <span className="text-[11px] uppercase tracking-wide text-[#6B7686] font-medium">Live demo</span>
        </div>
        <h2 className="font-[Barlow_Condensed] text-[26px] font-bold text-[#EDF1F5] tracking-wide mb-2">Welcome to YARDFLOW by ATCON Systems</h2>
        <p className="text-[13px] text-[#8A93A3] leading-relaxed mb-5">
          This is a live view of how a truck moves through the yard — from gate entry, through weighment
          and unloading, to final exit and QC sign-off. Switch roles to see exactly what each person on
          your team would see and do.
        </p>
        <button onClick={onClose}
          className="w-full rounded-[6px] bg-[#4C8CF5] py-2.5 text-sm font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors">
          Explore the dashboard
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role queue view — what Security / Yard Supervisor / Yard Incharge / QC see (no dashboard)
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  Expected: "Created trip",
  Departed: "Left MTC",
  Reported: "Reported at gate",
  "Approved for Entry": "Approved entry (yard)",
  Arrived: "Allowed inside",
  "Yard Assigned": "Assigned yard",
  "First Weighment": "First weighment recorded",
  Unloading: "Sent for unloading",
  Unloaded: "Second weighment recorded",
  "Exit Approval": "Approved exit",
  Exited: "Exit finalized",
  Completed: "Marked completed",
  "Refill Pending": "Sent for refill",
  Flagged: "Flagged",
  "Flag Cleared": "Cleared flag",
};

function HistoryView({ vehicles, roleFilter }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const entries = useMemo(() => {
    const list = [];
    vehicles.forEach((v) => {
      (v.history || []).forEach((h) => {
        if (!h.role) return; // system-level entries with no single actor, skip in personal/role logs
        if (roleFilter && h.role !== roleFilter) return;
        list.push({ ...h, vehicleNumber: v.vehicleNumber, vendor: v.vendor });
      });
    });
    return list.sort((a, b) => b.at - a.at);
  }, [vehicles, roleFilter]);

  const visibleEntries = useMemo(() => {
    return entries.filter((e) => {
      if (fromDate && e.at < new Date(fromDate).getTime()) return false;
      if (toDate && e.at > new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
      return true;
    });
  }, [entries, fromDate, toDate]);

  const inputCls = "rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-2.5 py-1.5 text-[#EDF1F5] text-[12px] font-mono focus:outline-none focus:border-[#4C8CF5]";

  return (
    <div>
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="font-[Barlow_Condensed] text-[22px] font-bold text-[#EDF1F5] tracking-wide">
            {roleFilter ? `${roleFilter} — history` : "Full activity history"}
          </div>
          <div className="text-[12px] text-[#8A93A3]">
            {roleFilter ? "Only actions you've personally taken are shown here." : "Every action taken by every role."}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] text-[#6B7686] uppercase tracking-wide">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputCls} />
          <label className="text-[11px] text-[#6B7686] uppercase tracking-wide">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputCls} />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(""); setToDate(""); }}
              className="flex items-center gap-1 text-[11px] text-[#8A93A3] hover:text-[#EDF1F5] border border-[#242B34] rounded-[4px] px-2 py-1.5">
              <X size={11} /> Clear
            </button>
          )}
        </div>
      </div>
      <div className="rounded-[6px] border border-[#242B34] overflow-hidden overflow-x-auto">
        <table className="w-full text-[13px] min-w-[700px]">
          <thead>
            <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium">When</th>
              <th className="text-left px-4 py-2.5 font-medium">Vehicle</th>
              {!roleFilter && <th className="text-left px-4 py-2.5 font-medium">Role</th>}
              <th className="text-left px-4 py-2.5 font-medium">Action</th>
              <th className="text-left px-4 py-2.5 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((e, i) => (
              <tr key={i} className="border-t border-[#242B34]">
                <td className="px-4 py-2.5 font-mono text-[11px] text-[#8A93A3]">{formatDateTime(e.at)}</td>
                <td className="px-4 py-2.5 font-mono text-[13px] font-bold text-[#EDF1F5]">{e.vehicleNumber}</td>
                {!roleFilter && <td className="px-4 py-2.5 text-[#DCE2E8]">{e.role}</td>}
                <td className="px-4 py-2.5 text-[#DCE2E8]">
                  {ACTION_LABELS[e.status] || e.status}
                  {e.note && <span className="text-[11px] text-[#6B7686]"> — {e.note}</span>}
                </td>
                <td className="px-4 py-2.5">
                  {e.outcome === "not-approved" ? (
                    <Pill fg="#FF5C5C" bg="#2A1515" bd="#4A1E1E">Not approved</Pill>
                  ) : (
                    <Pill fg="#3ECF8E" bg="#122A22" bd="#1E4A3A">Approved</Pill>
                  )}
                </td>
              </tr>
            ))}
            {visibleEntries.length === 0 && (
              <tr><td colSpan={roleFilter ? 4 : 5} className="px-4 py-10 text-center text-[#5A6270] text-[13px]">No history in this range.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleQueueView({ role, vehicles, now, onAdvance, onFlag, onClearFlag, onSelect }) {
  const relevant = useMemo(
    () => vehicles.filter((v) => actionsFor(v, role).length > 0).sort((a, b) => a.statusAt - b.statusAt),
    [vehicles, role]
  );

  return (
    <div>
      <div className="mb-4">
        <div className="font-[Barlow_Condensed] text-[22px] font-bold text-[#EDF1F5] tracking-wide">{role} queue</div>
        <div className="text-[12px] text-[#8A93A3]">{relevant.length} vehicle{relevant.length === 1 ? "" : "s"} waiting on you right now</div>
      </div>
      <div className="rounded-[6px] border border-[#242B34] overflow-hidden overflow-x-auto">
        <table className="w-full text-[13px] min-w-[700px]">
          <thead>
            <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium">Vehicle</th>
              <th className="text-left px-4 py-2.5 font-medium">Vendor / Material</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Waiting</th>
              <th className="text-right px-4 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {relevant.map((v) => {
              const elapsed = now - v.statusAt;
              const overdue = WAITING_STAGES.includes(v.status) && elapsed > 60 * 60 * 1000;
              const sc = statusColor(v.status);
              return (
                <tr key={v.id} onClick={() => onSelect(v)} className="border-t border-[#242B34] hover:bg-[#151A20] cursor-pointer transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[13px] font-bold text-[#EDF1F5] tracking-wide">{v.vehicleNumber}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-[#DCE2E8]">{v.vendor}</div>
                    <div className="text-[11px] text-[#6B7686]">{v.material}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Pill fg={sc.fg} bg={sc.bg} bd={sc.bd}>{v.status}</Pill>
                      {v.flagged && <Pill fg="#FF5C5C" bg="#2A1515" bd="#4A1E1E">Flagged</Pill>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`font-mono flex items-center gap-1.5 ${overdue ? "text-[#FF5C5C] font-bold" : "text-[#8A93A3]"}`}>
                      {overdue && <AlertTriangle size={13} />}{formatElapsed(elapsed)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ActionButtons vehicle={v} role={role} onAdvance={onAdvance} onFlag={onFlag} onClearFlag={onClearFlag} compact />
                  </td>
                </tr>
              );
            })}
            {relevant.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[#5A6270] text-[13px]">Nothing waiting on you right now.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

function Dashboard({ actualRole, profile, onLogout }) {
  const [role, setRole] = useState(actualRole);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(null);
  const [view, setView] = useState(actualRole === "Admin" ? "dashboard" : "queue");
  const [filterKey, setFilterKey] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [weighRequest, setWeighRequest] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try { if (!localStorage.getItem("yardflow_seen_intro")) setShowWelcome(true); } catch (e) {}
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try { localStorage.setItem("yardflow_seen_intro", "1"); } catch (e) {}
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from("vehicles").select("*");
      if (!active) return;
      if (error) { setConnectionError(error.message); setLoading(false); return; }
      setVehicles(data.map(rowToVehicle));
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("vehicles-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setVehicles((vs) => (vs.some((v) => v.id === payload.new.id) ? vs : [rowToVehicle(payload.new), ...vs]));
        } else if (payload.eventType === "UPDATE") {
          setVehicles((vs) => vs.map((v) => (v.id === payload.new.id ? rowToVehicle(payload.new) : v)));
        } else if (payload.eventType === "DELETE") {
          setVehicles((vs) => vs.filter((v) => v.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const counts = useMemo(() => {
    const c = {};
    DASHBOARD_CARDS.forEach((card) => { c[card.key] = vehicles.filter(card.filter).length; });
    return c;
  }, [vehicles]);

  const visibleVehicles = useMemo(() => {
    let list = vehicles;
    if (filterKey) {
      const card = DASHBOARD_CARDS.find((c) => c.key === filterKey);
      if (card) list = list.filter(card.filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((v) => v.vehicleNumber.toLowerCase().includes(q) || v.vendor.toLowerCase().includes(q) || (v.po || "").toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => b.statusAt - a.statusAt);
  }, [vehicles, filterKey, search]);

  const handleCreate = useCallback(async (form) => {
    const at = Date.now();
    const row = {
      vehicle_number: form.vehicleNumber.toUpperCase(),
      driver: form.driver || "Not specified",
      mobile: form.mobile || "—",
      vendor: form.vendor,
      transporter: form.transporter,
      material: form.material,
      po: form.po || `PO-${randomBetween(10000, 99999)}`,
      invoice_no: form.invoiceNo || null,
      destination: form.destination,
      party_net_weight: form.partyNetWeight ? Number(form.partyNetWeight) : null,
      status: "Expected",
      status_at: new Date(at).toISOString(),
      history: [{ status: "Expected", at, role, outcome: "approved" }],
    };
    const { data, error } = await supabase.from("vehicles").insert(row).select();
    if (error) {
      setConnectionError(error.message);
    } else if (data && data[0]) {
      setVehicles((vs) => (vs.some((v) => v.id === data[0].id) ? vs : [rowToVehicle(data[0]), ...vs]));
    }
    setShowAddModal(false);
  }, [role]);

  const handleAdvance = useCallback(async (vehicle, action) => {
    if (action.type === "firstWeigh" || action.type === "secondWeigh") {
      setWeighRequest({ vehicle, action });
      return;
    }

    const at = Date.now();
    const actor = role === "Admin" ? action.role : role;

    let update = {};

    if (action.type === "advance") {
      update = { status: action.next, status_at: new Date(at).toISOString(), history: [...(vehicle.history || []), { status: action.next, at, role: actor, outcome: "approved" }], flagged: false, flag_reason: null, flagged_at: null };
    } else if (action.type === "assignYard") {
      update = { status: action.next, status_at: new Date(at).toISOString(), yard: YARDS[randomBetween(0, YARDS.length - 1)], history: [...(vehicle.history || []), { status: action.next, at, role: actor, outcome: "approved" }], flagged: false, flag_reason: null, flagged_at: null };
    } else if (action.type === "exitApprove") {
      const otherApproved = action.approverKey === "securityExitApproved" ? vehicle.yardExitApproved : vehicle.securityExitApproved;
      const approvalEntry = { status: "Exit Approval", at, role: action.approverLabel, outcome: "approved" };
      if (otherApproved) {
        update = {
          status: "Exited", status_at: new Date(at).toISOString(),
          [action.approverKey === "securityExitApproved" ? "security_exit_approved" : "yard_exit_approved"]: true,
          history: [...(vehicle.history || []), approvalEntry, { status: "Exited", at, role: null, outcome: "approved" }],
          flagged: false, flag_reason: null, flagged_at: null,
        };
      } else {
        update = {
          [action.approverKey === "securityExitApproved" ? "security_exit_approved" : "yard_exit_approved"]: true,
          history: [...(vehicle.history || []), approvalEntry],
        };
      }
    } else if (action.type === "finalize") {
      update = { status: action.outcome, status_at: new Date(at).toISOString(), history: [...(vehicle.history || []), { status: action.outcome, at, role: actor, outcome: "approved" }], flagged: false, flag_reason: null, flagged_at: null };
    }

    const { data, error } = await supabase.from("vehicles").update(update).eq("id", vehicle.id).select();
    if (error) setConnectionError(error.message);
    else if (data && data[0]) setVehicles((vs) => vs.map((v) => (v.id === data[0].id ? rowToVehicle(data[0]) : v)));
    setSelectedVehicle(null);
  }, [role]);

  const handleWeighSubmit = useCallback(async (weightValue) => {
    if (!weighRequest) return;
    const { vehicle, action } = weighRequest;
    const at = Date.now();
    const actor = role === "Admin" ? action.role : role;

    let update = {};
    if (action.type === "firstWeigh") {
      update = {
        status: action.next, status_at: new Date(at).toISOString(),
        gross_weight: weightValue,
        history: [...(vehicle.history || []), { status: action.next, at, role: actor, outcome: "approved", note: `Gross weight: ${weightValue.toLocaleString("en-IN")} kg` }],
        flagged: false, flag_reason: null, flagged_at: null,
      };
    } else if (action.type === "secondWeigh") {
      const net = vehicle.grossWeight != null ? vehicle.grossWeight - weightValue : null;
      update = {
        status: action.next, status_at: new Date(at).toISOString(),
        tare_weight: weightValue, net_weight: net,
        history: [...(vehicle.history || []), { status: action.next, at, role: actor, outcome: "approved", note: `Tare weight: ${weightValue.toLocaleString("en-IN")} kg${net != null ? `, Net: ${net.toLocaleString("en-IN")} kg` : ""}` }],
        flagged: false, flag_reason: null, flagged_at: null,
      };
    }

    const { data, error } = await supabase.from("vehicles").update(update).eq("id", vehicle.id).select();
    if (error) setConnectionError(error.message);
    else if (data && data[0]) setVehicles((vs) => vs.map((v) => (v.id === data[0].id ? rowToVehicle(data[0]) : v)));
    setWeighRequest(null);
    setSelectedVehicle(null);
  }, [weighRequest, role]);

  const handleFlag = useCallback(async (vehicle) => {
    const reason = window.prompt(`Mark "${vehicle.vehicleNumber}" as not reached / not done yet.\n\nOptional short reason:`, "");
    if (reason === null) return;
    const at = Date.now();
    const update = {
      flagged: true, flag_reason: reason || null, flagged_at: new Date(at).toISOString(),
      history: [...(vehicle.history || []), { status: "Flagged", at, role, outcome: "not-approved", note: reason || null }],
    };
    const { data, error } = await supabase.from("vehicles").update(update).eq("id", vehicle.id).select();
    if (error) setConnectionError(error.message);
    else if (data && data[0]) setVehicles((vs) => vs.map((v) => (v.id === data[0].id ? rowToVehicle(data[0]) : v)));
  }, [role]);

  const handleClearFlag = useCallback(async (vehicle) => {
    const at = Date.now();
    const update = {
      flagged: false, flag_reason: null, flagged_at: null,
      history: [...(vehicle.history || []), { status: "Flag Cleared", at, role, outcome: "approved" }],
    };
    const { data, error } = await supabase.from("vehicles").update(update).eq("id", vehicle.id).select();
    if (error) setConnectionError(error.message);
    else if (data && data[0]) setVehicles((vs) => vs.map((v) => (v.id === data[0].id ? rowToVehicle(data[0]) : v)));
  }, [role]);

  const handleClearAll = useCallback(async () => {
    if (!window.confirm("Delete every vehicle currently in the system? This cannot be undone.")) return;
    setResetting(true);
    const { data: existing } = await supabase.from("vehicles").select("id");
    if (existing && existing.length) await supabase.from("vehicles").delete().in("id", existing.map((r) => r.id));
    setVehicles([]);
    setResetting(false);
  }, []);

  const isAdmin = role === "Admin";

  return (
    <div className="w-full min-h-[600px] bg-[#0E1116] text-[#EDF1F5]" style={{ fontFamily: "Inter, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #2A323D; border-radius: 4px; }
      `}</style>

      <div className="border-b border-[#1C222A] bg-[#0E1116] sticky top-0 z-30">
        <div className="max-w-[1200px] mx-auto px-5 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[6px] bg-[#4C8CF5] flex items-center justify-center">
              <Truck size={17} className="text-[#08111F]" />
            </div>
            <div>
              <div className="font-[Barlow_Condensed] text-[19px] font-bold leading-none tracking-wide">YARDFLOW <span className="text-[#5A6270] font-normal">by ATCON Systems</span></div>
              <div className="text-[10px] text-[#5A6270] leading-none mt-0.5 flex items-center gap-1">
                {connectionError ? (<><WifiOff size={10} className="text-[#FF5C5C]" /> Connection issue</>) : (<><Wifi size={10} className="text-[#3ECF8E]" /> Live · connected</>)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-[6px] border border-[#242B34] bg-[#161B22] px-2.5 py-1.5">
              <User size={14} className="text-[#6B7686]" />
              <div className="text-[13px] text-[#EDF1F5] leading-tight">
                <div className="font-medium">{profile.full_name || profile.email}</div>
                <div className="text-[10px] text-[#6B7686]">
                  {actualRole}{role !== actualRole ? ` — viewing as ${role}` : ""}
                </div>
              </div>
            </div>

            {actualRole === "Admin" && (
              <div className="flex items-center gap-1.5 rounded-[6px] border border-[#242B34] bg-[#161B22] px-2.5 py-1.5">
                <Layers size={14} className="text-[#6B7686]" />
                <select value={role} onChange={(e) => { setRole(e.target.value); setFilterKey(null); setView(e.target.value === "Admin" ? "dashboard" : "queue"); }}
                  className="bg-transparent text-[13px] text-[#EDF1F5] focus:outline-none">
                  {ROLES.map((r) => <option key={r} value={r} className="bg-[#161B22]">{r}</option>)}
                </select>
              </div>
            )}

            <button onClick={onLogout} title="Log out"
              className="flex items-center gap-1.5 rounded-[6px] border border-[#242B34] px-2.5 py-1.5 text-[12px] text-[#8A93A3] hover:text-[#EDF1F5] hover:border-[#3A4451] transition-colors">
              <LogOut size={13} /> Log out
            </button>

            {isAdmin && (
              <div className="flex rounded-[6px] border border-[#242B34] overflow-hidden">
                <button onClick={() => setView("dashboard")} className={`px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${view === "dashboard" ? "bg-[#4C8CF5] text-[#08111F] font-semibold" : "text-[#8A93A3] hover:bg-[#161B22]"}`}>
                  <Gauge size={14} /> Dashboard
                </button>
                <button onClick={() => setView("reports")} className={`px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${view === "reports" ? "bg-[#4C8CF5] text-[#08111F] font-semibold" : "text-[#8A93A3] hover:bg-[#161B22]"}`}>
                  <BarChart3 size={14} /> Reports
                </button>
                <button onClick={() => setView("history")} className={`px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${view === "history" ? "bg-[#4C8CF5] text-[#08111F] font-semibold" : "text-[#8A93A3] hover:bg-[#161B22]"}`}>
                  <ClipboardList size={14} /> History
                </button>
              </div>
            )}

            {!isAdmin && (
              <div className="flex rounded-[6px] border border-[#242B34] overflow-hidden">
                <button onClick={() => setView("queue")} className={`px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${view === "queue" ? "bg-[#4C8CF5] text-[#08111F] font-semibold" : "text-[#8A93A3] hover:bg-[#161B22]"}`}>
                  <Gauge size={14} /> Queue
                </button>
                <button onClick={() => setView("history")} className={`px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${view === "history" ? "bg-[#4C8CF5] text-[#08111F] font-semibold" : "text-[#8A93A3] hover:bg-[#161B22]"}`}>
                  <ClipboardList size={14} /> History
                </button>
              </div>
            )}

            {(role === "Vendor" || isAdmin) && (
              <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 rounded-[6px] bg-[#4C8CF5] px-3 py-1.5 text-[13px] font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors">
                <Plus size={15} /> New vehicle
              </button>
            )}
            {isAdmin && (
              <button onClick={handleClearAll} disabled={resetting} title="Delete all vehicles from the system"
                className="flex items-center gap-1.5 rounded-[6px] border border-[#242B34] px-3 py-1.5 text-[13px] text-[#8A93A3] hover:text-[#EDF1F5] hover:border-[#3A4451] transition-colors disabled:opacity-50">
                <RotateCcw size={14} className={resetting ? "animate-spin" : ""} /> {resetting ? "Clearing…" : "Clear all"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-5 py-5">
        {connectionError && (
          <div className="mb-4 rounded-[6px] border border-[#4A3A1E] bg-[#2A2015] px-4 py-3 text-[13px] text-[#F2A93B]">
            Couldn't reach Supabase: {connectionError}.
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-[#5A6270] text-sm">Loading vehicles from database…</div>
        ) : !isAdmin ? (
          view === "history" ? (
            <HistoryView vehicles={vehicles} roleFilter={role} />
          ) : role === "Vendor" ? (
            <div>
              <div className="mb-4">
                <div className="font-[Barlow_Condensed] text-[22px] font-bold text-[#EDF1F5] tracking-wide">Your trips</div>
                <div className="text-[12px] text-[#8A93A3]">Create a new trip, mark it once it leaves your MTC, or check on one you've already registered.</div>
              </div>
              <div className="rounded-[6px] border border-[#242B34] overflow-hidden overflow-x-auto">
                <table className="w-full text-[13px] min-w-[700px]">
                  <thead>
                    <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5 font-medium">Vehicle</th>
                      <th className="text-left px-4 py-2.5 font-medium">Vendor / Material</th>
                      <th className="text-left px-4 py-2.5 font-medium">Status</th>
                      <th className="text-right px-4 py-2.5 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...vehicles].sort((a, b) => b.statusAt - a.statusAt).map((v) => {
                      const sc = statusColor(v.status);
                      return (
                        <tr key={v.id} onClick={() => setSelectedVehicle(v)} className="border-t border-[#242B34] hover:bg-[#151A20] cursor-pointer transition-colors">
                          <td className="px-4 py-2.5 font-mono text-[13px] font-bold text-[#EDF1F5]">{v.vehicleNumber}</td>
                          <td className="px-4 py-2.5"><div className="text-[#DCE2E8]">{v.vendor}</div><div className="text-[11px] text-[#6B7686]">{v.material}</div></td>
                          <td className="px-4 py-2.5"><Pill fg={sc.fg} bg={sc.bg} bd={sc.bd}>{v.status}</Pill></td>
                          <td className="px-4 py-2.5 text-right">
                            <ActionButtons vehicle={v} role={role} onAdvance={handleAdvance} onFlag={handleFlag} onClearFlag={handleClearFlag} compact />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <RoleQueueView role={role} vehicles={vehicles} now={now} onAdvance={handleAdvance} onFlag={handleFlag} onClearFlag={handleClearFlag} onSelect={setSelectedVehicle} />
          )
        ) : view === "history" ? (
          <HistoryView vehicles={vehicles} roleFilter={null} />
        ) : view === "dashboard" ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5 mb-5">
              {DASHBOARD_CARDS.map((card) => (
                <StatCard key={card.key} card={card} count={counts[card.key]} active={filterKey === card.key} onClick={() => setFilterKey(filterKey === card.key ? null : card.key)} />
              ))}
            </div>

            <div className="flex items-center gap-2.5 mb-3 flex-wrap">
              <div className="flex items-center gap-2 rounded-[6px] border border-[#242B34] bg-[#161B22] px-3 py-2 flex-1 min-w-[220px]">
                <Search size={15} className="text-[#5A6270]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vehicle number, vendor, or PO"
                  className="bg-transparent text-[13px] text-[#EDF1F5] placeholder:text-[#5A6270] focus:outline-none flex-1" />
              </div>
              {filterKey && (
                <button onClick={() => setFilterKey(null)} className="flex items-center gap-1.5 text-[12px] text-[#8A93A3] hover:text-[#EDF1F5] border border-[#242B34] rounded-[6px] px-2.5 py-2">
                  <Filter size={13} /> Clear filter <X size={13} />
                </button>
              )}
              <div className="text-[11px] text-[#5A6270] font-mono">Live · updated {formatClock(now)}</div>
            </div>

            <div className="rounded-[6px] border border-[#242B34] overflow-hidden overflow-x-auto">
              <table className="w-full text-[13px] min-w-[880px]">
                <thead>
                  <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 font-medium">Vehicle</th>
                    <th className="text-left px-4 py-2.5 font-medium">Vendor / Material</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium">Time in stage</th>
                    <th className="text-right px-4 py-2.5 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleVehicles.map((v) => {
                    const elapsed = now - v.statusAt;
                    const isWaiting = WAITING_STAGES.includes(v.status);
                    const overdue = isWaiting && elapsed > 60 * 60 * 1000;
                    const sc = statusColor(v.status);
                    return (
                      <tr key={v.id} onClick={() => setSelectedVehicle(v)} className="border-t border-[#242B34] hover:bg-[#151A20] cursor-pointer transition-colors">
                        <td className="px-4 py-2.5"><div className="font-mono text-[13px] font-bold text-[#EDF1F5] tracking-wide">{v.vehicleNumber}</div></td>
                        <td className="px-4 py-2.5"><div className="text-[#DCE2E8]">{v.vendor}</div><div className="text-[11px] text-[#6B7686]">{v.material}</div></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Pill fg={sc.fg} bg={sc.bg} bd={sc.bd}>{v.status}</Pill>
                            {v.flagged && !["Completed", "Refill Pending"].includes(v.status) && <Pill fg="#FF5C5C" bg="#2A1515" bd="#4A1E1E">Flagged</Pill>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`font-mono flex items-center gap-1.5 ${overdue ? "text-[#FF5C5C] font-bold" : isWaiting ? "text-[#F2A93B]" : "text-[#8A93A3]"}`}>
                            {overdue && <AlertTriangle size={13} />}{formatElapsed(elapsed)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <ActionButtons vehicle={v} role={role} onAdvance={handleAdvance} onFlag={handleFlag} onClearFlag={handleClearFlag} compact />
                        </td>
                      </tr>
                    );
                  })}
                  {visibleVehicles.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-[#5A6270] text-[13px]">No vehicles match this view.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <ReportsView vehicles={vehicles} />
        )}
      </div>

      {selectedVehicle && (
        <DetailDrawer
          vehicle={vehicles.find((v) => v.id === selectedVehicle.id) || selectedVehicle}
          role={role}
          onClose={() => setSelectedVehicle(null)}
          onAdvance={handleAdvance}
          onFlag={handleFlag}
          onClearFlag={handleClearFlag}
        />
      )}
      {showAddModal && <AddVehicleModal onClose={() => setShowAddModal(false)} onCreate={handleCreate} />}
      <WeighInModal request={weighRequest} onClose={() => setWeighRequest(null)} onSubmit={handleWeighSubmit} />
      {showWelcome && <WelcomeModal onClose={dismissWelcome} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------

function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError("Incorrect email or password.");
      return;
    }
    onSignedIn(data.session);
  };

  return (
    <div className="w-full min-h-[600px] bg-[#0E1116] text-[#EDF1F5] flex items-center justify-center px-4" style={{ fontFamily: "Inter, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
        .font-mono { font-family: 'JetBrains Mono', monospace; }
      `}</style>
      <form onSubmit={submit} className="w-full max-w-sm rounded-[10px] border border-[#242B34] bg-[#14181E] p-6 shadow-2xl">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-[6px] bg-[#4C8CF5] flex items-center justify-center">
            <Truck size={19} className="text-[#08111F]" />
          </div>
          <div>
            <div className="font-[Barlow_Condensed] text-[20px] font-bold leading-none tracking-wide">YARDFLOW</div>
            <div className="text-[10px] text-[#5A6270] leading-none mt-0.5">by ATCON Systems</div>
          </div>
        </div>

        <div className="space-y-3 mb-2">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">Email</label>
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm focus:outline-none focus:border-[#4C8CF5]" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm focus:outline-none focus:border-[#4C8CF5]" />
          </div>
        </div>

        {error && <div className="text-[12px] text-[#FF5C5C] mb-3">{error}</div>}

        <button type="submit" disabled={submitting}
          className="w-full rounded-[6px] bg-[#4C8CF5] py-2.5 text-sm font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors disabled:opacity-60 mt-1">
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <div className="text-[11px] text-[#5A6270] text-center mt-4">
          Accounts are created by your administrator. Contact them if you don't have login details.
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth wrapper — the real default export
// ---------------------------------------------------------------------------

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileError, setProfileError] = useState("");

  const loadProfile = useCallback(async (currentSession) => {
    if (!currentSession) { setProfile(null); return; }
    const { data, error } = await supabase.from("profiles").select("*").eq("user_id", currentSession.user.id).single();
    if (error || !data) {
      setProfileError("Your account doesn't have a role assigned yet. Contact your admin.");
      setProfile(null);
    } else {
      setProfileError("");
      setProfile(data);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session).finally(() => setAuthLoading(false));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadProfile(newSession);
    });

    return () => { listener.subscription.unsubscribe(); };
  }, [loadProfile]);

  const handleSignedIn = useCallback((newSession) => {
    setSession(newSession);
    loadProfile(newSession);
  }, [loadProfile]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  if (authLoading) {
    return <div className="w-full min-h-[400px] bg-[#0E1116] flex items-center justify-center text-[#5A6270] text-sm">Loading…</div>;
  }

  if (!session) {
    return <LoginScreen onSignedIn={handleSignedIn} />;
  }

  if (!profile) {
    return (
      <div className="w-full min-h-[400px] bg-[#0E1116] flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <div className="text-[#F2A93B] text-sm mb-4">{profileError || "Loading your account…"}</div>
          <button onClick={handleLogout} className="rounded-[6px] border border-[#242B34] px-4 py-2 text-sm text-[#8A93A3] hover:text-[#EDF1F5]">Log out</button>
        </div>
      </div>
    );
  }

  return <Dashboard actualRole={profile.role} profile={profile} onLogout={handleLogout} />;
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Truck,
  Scale,
  PackageCheck,
  ShieldCheck,
  LogOut,
  Plus,
  X,
  Search,
  Clock,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Warehouse,
  ClipboardList,
  BarChart3,
  Gauge,
  Radio,
  ArrowRight,
  Filter,
  User,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const ROLES = [
  'Vendor',
  'Security',
  'Yard Supervisor',
  'Weighbridge Operator',
  'Loading Supervisor',
  'QC',
  'Admin',
];

const TRANSITIONS = {
  Expected: {
    role: 'Security',
    label: 'Vehicle Arrived',
    next: 'Arrived',
    icon: ShieldCheck,
  },
  Arrived: {
    role: 'Yard Supervisor',
    label: 'Assign Yard',
    next: 'Yard Assigned',
    icon: Warehouse,
    needsYard: true,
  },
  'Yard Assigned': {
    role: 'Yard Supervisor',
    label: 'Send to Weighbridge',
    next: 'Sent to Weighbridge',
    icon: ArrowRight,
  },
  'Sent to Weighbridge': {
    role: 'Weighbridge Operator',
    label: 'Start Weighment',
    next: 'Weighed In',
    icon: Scale,
    weight: 'gross',
  },
  'Weighed In': {
    role: 'Loading Supervisor',
    label: 'Loading Started',
    next: 'Loading',
    icon: PackageCheck,
  },
  Loading: {
    role: 'Loading Supervisor',
    label: 'Loading Complete',
    next: 'Loading Complete',
    icon: PackageCheck,
  },
  'Loading Complete': {
    role: 'Weighbridge Operator',
    label: 'Second Weighment',
    next: 'Weighed Out',
    icon: Scale,
    weight: 'tare',
  },
  'Weighed Out': {
    role: 'QC',
    label: 'Approve',
    next: 'QC Approved',
    icon: CheckCircle2,
  },
  'QC Approved': {
    role: 'Security',
    label: 'Vehicle Out',
    next: 'Exited',
    icon: LogOut,
  },
};

const WAITING_STAGES = ['Yard Assigned', 'Sent to Weighbridge'];
const VENDORS = [
  'Shree Cement Traders',
  'Balaji Logistics',
  'Om Sai Carriers',
  'Patel Freight Co',
  'Ganesh Roadlines',
];
const MATERIALS = [
  'Cement',
  'Steel Coils',
  'Fly Ash',
  'River Sand',
  'Clinker',
  'Gypsum',
];
const DESTINATIONS = [
  'Silo A',
  'Silo B',
  'Warehouse 3',
  'Plant Gate 2',
  'Stockyard 1',
];
const YARDS = [
  'Yard A - Slot 1',
  'Yard A - Slot 2',
  'Yard B - Slot 5',
  'Yard B - Slot 6',
  'Yard C - Slot 3',
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function minutesAgo(mins) {
  return Date.now() - mins * 60 * 1000;
}

function randomVehicleNo() {
  const states = ['MH', 'GJ', 'RJ', 'UP', 'MP'];
  const s = states[randomBetween(0, states.length - 1)];
  const num1 = randomBetween(10, 99);
  const letters =
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    String.fromCharCode(65 + Math.floor(Math.random() * 26));
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

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
function formatDateTime(ts) {
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusColor(status) {
  if (status === 'Expected')
    return { fg: '#8A93A3', bg: '#1A2029', bd: '#2A323D' };
  if (status === 'Exited')
    return { fg: '#3ECF8E', bg: '#122A22', bd: '#1E4A3A' };
  if (WAITING_STAGES.includes(status))
    return { fg: '#F2A93B', bg: '#2A2015', bd: '#4A3A1E' };
  return { fg: '#4C8CF5', bg: '#122238', bd: '#1E3A5C' };
}

// ---------------------------------------------------------------------------
// Row <-> app object mapping (Supabase uses snake_case columns)
// ---------------------------------------------------------------------------

function rowToVehicle(row) {
  return {
    id: row.id,
    vehicleNumber: row.vehicle_number,
    driver: row.driver,
    mobile: row.mobile,
    vendor: row.vendor,
    material: row.material,
    po: row.po,
    destination: row.destination,
    status: row.status,
    statusAt: row.status_at ? new Date(row.status_at).getTime() : Date.now(),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    yard: row.yard,
    grossWeight: row.gross_weight,
    tareWeight: row.tare_weight,
    netWeight: row.net_weight,
    history: row.history || [],
  };
}

function buildSeedRows() {
  const seed = (mins, status, extra = {}) => {
    const at = minutesAgo(mins);
    return {
      vehicle_number: randomVehicleNo(),
      driver: 'Ramesh Yadav',
      mobile: '98' + randomBetween(10000000, 99999999),
      vendor: VENDORS[randomBetween(0, VENDORS.length - 1)],
      material: MATERIALS[randomBetween(0, MATERIALS.length - 1)],
      po: 'PO-' + randomBetween(10000, 99999),
      destination: DESTINATIONS[randomBetween(0, DESTINATIONS.length - 1)],
      status,
      status_at: new Date(at).toISOString(),
      history: [{ status, at }],
      ...extra,
    };
  };

  return [
    seed(5, 'Expected'),
    seed(20, 'Expected'),
    seed(75, 'Yard Assigned', { yard: YARDS[0] }),
    seed(68, 'Sent to Weighbridge', { yard: YARDS[2] }),
    seed(18, 'Loading', { yard: YARDS[3], gross_weight: 31200 }),
    seed(9, 'Weighed Out', {
      yard: YARDS[4],
      gross_weight: 29800,
      tare_weight: 9600,
      net_weight: 20200,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

function Pill({ children, fg, bg, bd }) {
  return (
    <span
      style={{ color: fg, backgroundColor: bg, borderColor: bd }}
      className="inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[11px] font-semibold tracking-wide uppercase"
    >
      {children}
    </span>
  );
}

function StatCard({ card, count, active, onClick }) {
  const Icon = card.icon;
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-[6px] border px-4 py-3 transition-colors ${
        active
          ? 'border-[#4C8CF5] bg-[#122238]'
          : 'border-[#242B34] bg-[#161B22] hover:border-[#323B47]'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon size={16} className="text-[#6B7686]" />
        {(card.key === 'WBWait' || card.key === 'YardWait') && (
          <Radio size={10} className="text-[#F2A93B] animate-pulse" />
        )}
      </div>
      <div className="font-[Barlow_Condensed] text-[28px] leading-none font-bold text-[#EDF1F5] tabular-nums">
        {count}
      </div>
      <div className="text-[11px] text-[#8A93A3] mt-1.5 leading-tight">
        {card.label}
      </div>
    </button>
  );
}

const DASHBOARD_CARDS = [
  {
    key: 'Expected',
    label: 'Expected today',
    icon: Clock,
    filter: (v) => v.status === 'Expected',
  },
  {
    key: 'Inside',
    label: 'Inside plant',
    icon: Truck,
    filter: (v) => v.status !== 'Expected' && v.status !== 'Exited',
  },
  {
    key: 'YardWait',
    label: 'Waiting in yard',
    icon: Warehouse,
    filter: (v) => v.status === 'Yard Assigned',
  },
  {
    key: 'WBWait',
    label: 'Waiting for weighment',
    icon: Scale,
    filter: (v) => v.status === 'Sent to Weighbridge',
  },
  {
    key: 'Loading',
    label: 'Loading in progress',
    icon: PackageCheck,
    filter: (v) => v.status === 'Loading',
  },
  {
    key: 'QCPending',
    label: 'QC pending',
    icon: ClipboardList,
    filter: (v) => v.status === 'Weighed Out',
  },
  {
    key: 'Ready',
    label: 'Ready for dispatch',
    icon: CheckCircle2,
    filter: (v) => v.status === 'QC Approved',
  },
  {
    key: 'ExitedToday',
    label: 'Exited today',
    icon: LogOut,
    filter: (v) => v.status === 'Exited',
  },
];

function AddVehicleModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    vehicleNumber: '',
    driver: '',
    mobile: '',
    vendor: VENDORS[0],
    material: MATERIALS[0],
    po: '',
    destination: DESTINATIONS[0],
  });
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    if (!form.vehicleNumber.trim()) return;
    onCreate(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-[8px] border border-[#2A323D] bg-[#14181E] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-[Barlow_Condensed] text-[20px] font-bold text-[#EDF1F5] tracking-wide">
            New vehicle entry
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6B7686] hover:text-[#EDF1F5]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">
              Vehicle number *
            </label>
            <input
              autoFocus
              value={form.vehicleNumber}
              onChange={update('vehicleNumber')}
              placeholder="MH12AB1234"
              className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] font-mono text-sm focus:outline-none focus:border-[#4C8CF5]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">
                Driver name
              </label>
              <input
                value={form.driver}
                onChange={update('driver')}
                placeholder="Ramesh Yadav"
                className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm focus:outline-none focus:border-[#4C8CF5]"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">
                Mobile
              </label>
              <input
                value={form.mobile}
                onChange={update('mobile')}
                placeholder="9812345678"
                className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] font-mono text-sm focus:outline-none focus:border-[#4C8CF5]"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">
              Vendor
            </label>
            <select
              value={form.vendor}
              onChange={update('vendor')}
              className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm focus:outline-none focus:border-[#4C8CF5]"
            >
              {VENDORS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">
                Material
              </label>
              <select
                value={form.material}
                onChange={update('material')}
                className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm focus:outline-none focus:border-[#4C8CF5]"
              >
                {MATERIALS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">
                PO number
              </label>
              <input
                value={form.po}
                onChange={update('po')}
                placeholder="PO-48213"
                className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] font-mono text-sm focus:outline-none focus:border-[#4C8CF5]"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[#6B7686] mb-1">
              Destination
            </label>
            <select
              value={form.destination}
              onChange={update('destination')}
              className="w-full rounded-[4px] bg-[#1C222A] border border-[#2A323D] px-3 py-2 text-[#EDF1F5] text-sm focus:outline-none focus:border-[#4C8CF5]"
            >
              {DESTINATIONS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-[4px] border border-[#2A323D] py-2 text-sm text-[#8A93A3] hover:text-[#EDF1F5] hover:border-[#3A4451] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 rounded-[4px] bg-[#4C8CF5] py-2 text-sm font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors"
          >
            Create trip
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#5A6270]">
        {label}
      </div>
      <div className={`text-[#DCE2E8] ${mono ? 'font-mono text-[12px]' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function WeightReadout({ label, value, highlight }) {
  return (
    <div
      className={`rounded-[4px] border px-2 py-2 text-center ${
        highlight
          ? 'border-[#3ECF8E] bg-[#122A22]'
          : 'border-[#2A323D] bg-[#1C222A]'
      }`}
    >
      <div className="text-[9px] uppercase tracking-wide text-[#6B7686]">
        {label}
      </div>
      <div
        className={`font-mono text-[14px] font-bold tabular-nums ${
          highlight ? 'text-[#3ECF8E]' : 'text-[#DCE2E8]'
        }`}
      >
        {value ? value.toLocaleString('en-IN') : '—'}
      </div>
      <div className="text-[8px] text-[#5A6270]">kg</div>
    </div>
  );
}

function DetailDrawer({ vehicle, role, onClose, onAdvance }) {
  if (!vehicle) return null;
  const t = TRANSITIONS[vehicle.status];
  const canAct = t && (t.role === role || role === 'Admin');
  const sc = statusColor(vehicle.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="w-full max-w-md h-full bg-[#12161C] border-l border-[#242B34] overflow-y-auto">
        <div className="sticky top-0 bg-[#12161C] border-b border-[#242B34] px-5 py-4 flex items-center justify-between">
          <div>
            <div className="font-mono text-[20px] font-bold text-[#EDF1F5] tracking-wider">
              {vehicle.vehicleNumber}
            </div>
            <div className="text-[12px] text-[#6B7686]">ID: {vehicle.id}</div>
          </div>
          <button
            onClick={onClose}
            className="text-[#6B7686] hover:text-[#EDF1F5]"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5">
          <div className="relative rounded-[8px] border border-[#242B34] bg-[#161B22] p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <Pill fg={sc.fg} bg={sc.bg} bd={sc.bd}>
                {vehicle.status}
              </Pill>
              <span className="text-[11px] text-[#6B7686] font-mono">
                {formatDateTime(vehicle.statusAt)}
              </span>
            </div>
            <div className="border-t border-dashed border-[#2A323D] my-3" />
            <div className="grid grid-cols-2 gap-y-2.5 gap-x-3 text-[13px]">
              <Field label="Vendor" value={vehicle.vendor} />
              <Field label="Material" value={vehicle.material} />
              <Field label="PO number" value={vehicle.po} mono />
              <Field label="Destination" value={vehicle.destination} />
              <Field label="Driver" value={vehicle.driver} />
              <Field label="Mobile" value={vehicle.mobile} mono />
              {vehicle.yard && <Field label="Yard slot" value={vehicle.yard} />}
            </div>
            {(vehicle.grossWeight || vehicle.tareWeight) && (
              <>
                <div className="border-t border-dashed border-[#2A323D] my-3" />
                <div className="grid grid-cols-3 gap-2">
                  <WeightReadout label="Gross" value={vehicle.grossWeight} />
                  <WeightReadout label="Tare" value={vehicle.tareWeight} />
                  <WeightReadout
                    label="Net"
                    value={vehicle.netWeight}
                    highlight
                  />
                </div>
              </>
            )}
          </div>

          {canAct && (
            <button
              onClick={() => onAdvance(vehicle)}
              className="w-full flex items-center justify-center gap-2 rounded-[6px] bg-[#4C8CF5] py-2.5 text-sm font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors mb-6"
            >
              <t.icon size={16} />
              {t.label}
            </button>
          )}
          {!canAct && t && (
            <div className="mb-6 rounded-[6px] border border-[#2A323D] bg-[#161B22] px-3 py-2.5 text-[12px] text-[#6B7686]">
              Awaiting action from{' '}
              <span className="text-[#8A93A3] font-medium">{t.role}</span>
            </div>
          )}

          <div className="text-[11px] uppercase tracking-wide text-[#6B7686] mb-3">
            Journey timeline
          </div>
          <div className="space-y-0">
            {(vehicle.history || []).map((h, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-[#4C8CF5] mt-1.5 shrink-0" />
                  {i < vehicle.history.length - 1 && (
                    <div className="w-px flex-1 bg-[#2A323D]" />
                  )}
                </div>
                <div className="pb-4">
                  <div className="text-[13px] text-[#EDF1F5]">{h.status}</div>
                  <div className="text-[11px] text-[#6B7686] font-mono">
                    {formatDateTime(h.at)}
                  </div>
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
  const metrics = [
    {
      label: 'Avg. gate-to-yard time',
      value: avgBetween(vehicles, 'Arrived', 'Yard Assigned'),
    },
    {
      label: 'Avg. yard waiting time',
      value: avgBetween(vehicles, 'Yard Assigned', 'Sent to Weighbridge'),
    },
    {
      label: 'Avg. weighbridge wait',
      value: avgBetween(vehicles, 'Sent to Weighbridge', 'Weighed In'),
    },
    {
      label: 'Avg. loading duration',
      value: avgBetween(vehicles, 'Loading', 'Loading Complete'),
    },
    {
      label: 'Avg. total turnaround',
      value: avgBetween(vehicles, 'Arrived', 'Exited'),
    },
  ];
  const vendorStats = useMemo(() => {
    const map = {};
    vehicles.forEach((v) => {
      map[v.vendor] = map[v.vendor] || { total: 0, exited: 0 };
      map[v.vendor].total += 1;
      if (v.status === 'Exited') map[v.vendor].exited += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [vehicles]);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-[6px] border border-[#242B34] bg-[#161B22] px-4 py-3"
          >
            <div className="font-mono text-[22px] font-bold text-[#EDF1F5] tabular-nums">
              {m.value != null ? formatElapsed(m.value) : '—'}
            </div>
            <div className="text-[11px] text-[#8A93A3] mt-1 leading-tight">
              {m.label}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-[#6B7686] mb-2">
        Vendor-wise activity
      </div>
      <div className="rounded-[6px] border border-[#242B34] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Vendor</th>
              <th className="text-right px-4 py-2 font-medium">Total trips</th>
              <th className="text-right px-4 py-2 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {vendorStats.map(([vendor, s]) => (
              <tr key={vendor} className="border-t border-[#242B34]">
                <td className="px-4 py-2.5 text-[#DCE2E8]">{vendor}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#DCE2E8]">
                  {s.total}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[#3ECF8E]">
                  {s.exited}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

export default function App() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(null);
  const [role, setRole] = useState('Admin');
  const [view, setView] = useState('dashboard');
  const [filterKey, setFilterKey] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // Initial load + one-time seeding if the table is empty
  useEffect(() => {
    let active = true;

    async function load() {
      const { data, error } = await supabase.from('vehicles').select('*');
      if (!active) return;
      if (error) {
        setConnectionError(error.message);
        setLoading(false);
        return;
      }
      if (data.length === 0) {
        const { data: seeded, error: seedError } = await supabase
          .from('vehicles')
          .insert(buildSeedRows())
          .select();
        if (!seedError && seeded) setVehicles(seeded.map(rowToVehicle));
      } else {
        setVehicles(data.map(rowToVehicle));
      }
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  // Realtime subscription — this is what makes other tabs/devices update live
  useEffect(() => {
    const channel = supabase
      .channel('vehicles-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicles' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setVehicles((vs) =>
              vs.some((v) => v.id === payload.new.id)
                ? vs
                : [rowToVehicle(payload.new), ...vs]
            );
          } else if (payload.eventType === 'UPDATE') {
            setVehicles((vs) =>
              vs.map((v) =>
                v.id === payload.new.id ? rowToVehicle(payload.new) : v
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setVehicles((vs) => vs.filter((v) => v.id !== payload.old.id));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const counts = useMemo(() => {
    const c = {};
    DASHBOARD_CARDS.forEach((card) => {
      c[card.key] = vehicles.filter(card.filter).length;
    });
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
      list = list.filter(
        (v) =>
          v.vehicleNumber.toLowerCase().includes(q) ||
          v.vendor.toLowerCase().includes(q) ||
          v.po.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.statusAt - a.statusAt);
  }, [vehicles, filterKey, search]);

  const handleCreate = useCallback(async (form) => {
    const at = Date.now();
    const row = {
      vehicle_number: form.vehicleNumber.toUpperCase(),
      driver: form.driver || 'Not specified',
      mobile: form.mobile || '—',
      vendor: form.vendor,
      material: form.material,
      po: form.po || `PO-${randomBetween(10000, 99999)}`,
      destination: form.destination,
      status: 'Expected',
      status_at: new Date(at).toISOString(),
      history: [{ status: 'Expected', at }],
    };
    const { error } = await supabase.from('vehicles').insert(row);
    if (error) setConnectionError(error.message);
    setShowAddModal(false);
  }, []);

  const handleAdvance = useCallback(async (vehicle) => {
    const t = TRANSITIONS[vehicle.status];
    if (!t) return;
    const at = Date.now();
    const update = {
      status: t.next,
      status_at: new Date(at).toISOString(),
      history: [...(vehicle.history || []), { status: t.next, at }],
    };
    if (t.needsYard) update.yard = YARDS[randomBetween(0, YARDS.length - 1)];
    if (t.weight === 'gross') update.gross_weight = randomBetween(28000, 33000);
    if (t.weight === 'tare') {
      update.tare_weight = randomBetween(9000, 11000);
      update.net_weight =
        (vehicle.grossWeight || randomBetween(28000, 33000)) -
        update.tare_weight;
    }
    const { error } = await supabase
      .from('vehicles')
      .update(update)
      .eq('id', vehicle.id);
    if (error) setConnectionError(error.message);
    setSelectedVehicle(null);
  }, []);

  return (
    <div
      className="w-full min-h-[600px] bg-[#0E1116] text-[#EDF1F5]"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
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
              <div className="font-[Barlow_Condensed] text-[19px] font-bold leading-none tracking-wide">
                YARDFLOW
              </div>
              <div className="text-[10px] text-[#5A6270] leading-none mt-0.5 flex items-center gap-1">
                {connectionError ? (
                  <>
                    <WifiOff size={10} className="text-[#FF5C5C]" /> Connection
                    issue
                  </>
                ) : (
                  <>
                    <Wifi size={10} className="text-[#3ECF8E]" /> Live ·
                    connected
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-[6px] border border-[#242B34] bg-[#161B22] px-2.5 py-1.5">
              <User size={14} className="text-[#6B7686]" />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="bg-transparent text-[13px] text-[#EDF1F5] focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r} className="bg-[#161B22]">
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex rounded-[6px] border border-[#242B34] overflow-hidden">
              <button
                onClick={() => setView('dashboard')}
                className={`px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${
                  view === 'dashboard'
                    ? 'bg-[#4C8CF5] text-[#08111F] font-semibold'
                    : 'text-[#8A93A3] hover:bg-[#161B22]'
                }`}
              >
                <Gauge size={14} /> Dashboard
              </button>
              <button
                onClick={() => setView('reports')}
                className={`px-3 py-1.5 text-[13px] flex items-center gap-1.5 ${
                  view === 'reports'
                    ? 'bg-[#4C8CF5] text-[#08111F] font-semibold'
                    : 'text-[#8A93A3] hover:bg-[#161B22]'
                }`}
              >
                <BarChart3 size={14} /> Reports
              </button>
            </div>
            {(role === 'Vendor' || role === 'Admin') && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 rounded-[6px] bg-[#4C8CF5] px-3 py-1.5 text-[13px] font-semibold text-[#08111F] hover:bg-[#659BF7] transition-colors"
              >
                <Plus size={15} /> New vehicle
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-5 py-5">
        {connectionError && (
          <div className="mb-4 rounded-[6px] border border-[#4A3A1E] bg-[#2A2015] px-4 py-3 text-[13px] text-[#F2A93B]">
            Couldn't reach Supabase: {connectionError}. Check your project
            URL/key in supabaseClient.js.
          </div>
        )}
        {loading ? (
          <div className="text-center py-20 text-[#5A6270] text-sm">
            Loading vehicles from database…
          </div>
        ) : view === 'dashboard' ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-5">
              {DASHBOARD_CARDS.map((card) => (
                <StatCard
                  key={card.key}
                  card={card}
                  count={counts[card.key]}
                  active={filterKey === card.key}
                  onClick={() =>
                    setFilterKey(filterKey === card.key ? null : card.key)
                  }
                />
              ))}
            </div>

            <div className="flex items-center gap-2.5 mb-3 flex-wrap">
              <div className="flex items-center gap-2 rounded-[6px] border border-[#242B34] bg-[#161B22] px-3 py-2 flex-1 min-w-[220px]">
                <Search size={15} className="text-[#5A6270]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search vehicle number, vendor, or PO"
                  className="bg-transparent text-[13px] text-[#EDF1F5] placeholder:text-[#5A6270] focus:outline-none flex-1"
                />
              </div>
              {filterKey && (
                <button
                  onClick={() => setFilterKey(null)}
                  className="flex items-center gap-1.5 text-[12px] text-[#8A93A3] hover:text-[#EDF1F5] border border-[#242B34] rounded-[6px] px-2.5 py-2"
                >
                  <Filter size={13} /> Clear filter <X size={13} />
                </button>
              )}
              <div className="text-[11px] text-[#5A6270] font-mono">
                Live · updated {formatClock(now)}
              </div>
            </div>

            <div className="rounded-[6px] border border-[#242B34] overflow-hidden overflow-x-auto">
              <table className="w-full text-[13px] min-w-[880px]">
                <thead>
                  <tr className="bg-[#161B22] text-[#6B7686] text-[11px] uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 font-medium">
                      Vehicle
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium">
                      Vendor / Material
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium">
                      Status
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium">
                      Time in stage
                    </th>
                    <th className="text-right px-4 py-2.5 font-medium">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleVehicles.map((v) => {
                    const elapsed = now - v.statusAt;
                    const isWaiting = WAITING_STAGES.includes(v.status);
                    const overdue = isWaiting && elapsed > 60 * 60 * 1000;
                    const sc = statusColor(v.status);
                    const t = TRANSITIONS[v.status];
                    const canAct = t && (t.role === role || role === 'Admin');
                    return (
                      <tr
                        key={v.id}
                        onClick={() => setSelectedVehicle(v)}
                        className="border-t border-[#242B34] hover:bg-[#151A20] cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[13px] font-bold text-[#EDF1F5] tracking-wide">
                            {v.vehicleNumber}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-[#DCE2E8]">{v.vendor}</div>
                          <div className="text-[11px] text-[#6B7686]">
                            {v.material}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <Pill fg={sc.fg} bg={sc.bg} bd={sc.bd}>
                            {v.status}
                          </Pill>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`font-mono flex items-center gap-1.5 ${
                              overdue
                                ? 'text-[#FF5C5C] font-bold'
                                : isWaiting
                                ? 'text-[#F2A93B]'
                                : 'text-[#8A93A3]'
                            }`}
                          >
                            {overdue && <AlertTriangle size={13} />}
                            {formatElapsed(elapsed)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canAct ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdvance(v);
                              }}
                              className="inline-flex items-center gap-1 rounded-[4px] border border-[#3A5A8C] bg-[#122238] px-2.5 py-1.5 text-[12px] font-medium text-[#7CACF8] hover:bg-[#183155] transition-colors"
                            >
                              {t.label} <ChevronRight size={12} />
                            </button>
                          ) : (
                            <span className="text-[11px] text-[#5A6270]">
                              {t ? `Awaiting ${t.role}` : 'Completed'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleVehicles.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-[#5A6270] text-[13px]"
                      >
                        No vehicles match this view.
                      </td>
                    </tr>
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
          vehicle={
            vehicles.find((v) => v.id === selectedVehicle.id) || selectedVehicle
          }
          role={role}
          onClose={() => setSelectedVehicle(null)}
          onAdvance={handleAdvance}
        />
      )}
      {showAddModal && (
        <AddVehicleModal
          onClose={() => setShowAddModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

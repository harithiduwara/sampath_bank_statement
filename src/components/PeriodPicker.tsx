import { CalendarRange } from "lucide-react";
import { PRESETS, type PresetId } from "../lib/accounting";
import { date } from "../lib/format";
import { useWorkspace } from "../state/store";
import { fieldClass } from "./ui";

/** Period presets are anchored on the latest statement date; custom ranges use two date fields. */
export default function PeriodPicker() {
  const { state, period, range, actions } = useWorkspace();
  if (!range) return null;
  const custom = state.custom ?? range;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex items-center">
        <span className="sr-only">Period</span>
        <CalendarRange size={15} className="pointer-events-none absolute left-2.5 text-ink-3" aria-hidden="true" />
        <select
          value={state.preset}
          onChange={(e) => {
            const preset = e.target.value as PresetId;
            actions.setPeriod(preset, preset === "custom" ? state.custom ?? period ?? range : undefined);
          }}
          className={`${fieldClass} pl-8 pr-8 font-medium`}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {state.preset === "custom" ? (
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="period-from">
            From
          </label>
          <input
            id="period-from"
            type="date"
            value={custom.from}
            onChange={(e) => e.target.value && actions.setPeriod("custom", { ...custom, from: e.target.value })}
            className={`${fieldClass} w-[9.5rem]`}
          />
          <span className="text-ink-3" aria-hidden="true">
            –
          </span>
          <label className="sr-only" htmlFor="period-to">
            To
          </label>
          <input
            id="period-to"
            type="date"
            value={custom.to}
            onChange={(e) => e.target.value && actions.setPeriod("custom", { ...custom, to: e.target.value })}
            className={`${fieldClass} w-[9.5rem]`}
          />
        </div>
      ) : (
        period && (
          <span className="hidden text-xs text-ink-3 md:inline">
            {date(period.from)} – {date(period.to)}
          </span>
        )
      )}
    </div>
  );
}

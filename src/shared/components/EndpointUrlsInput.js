"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import Input from "./Input";

/**
 * Repeatable endpoint rows: one input per URL plus an "Add endpoint" button.
 * For providers whose endpoints are per connection (each Modal app has its own).
 */
export default function EndpointUrlsInput({
  values,
  onChange,
  label = "Endpoint URLs",
  hint,
  error,
  placeholder,
  addLabel = "Add endpoint",
  disabled = false,
  className,
}) {
  // Focus the freshly added row once (autoFocus only applies on mount).
  const [focusLast, setFocusLast] = useState(false);
  const rows = values.length ? values : [""];

  const setRow = (index, value) => onChange(rows.map((row, i) => (i === index ? value : row)));
  const addRow = () => {
    setFocusLast(true);
    onChange([...rows, ""]);
  };
  const removeRow = (index) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && <label className="text-sm font-medium text-text-main">{label}</label>}

      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={row}
              onChange={(e) => setRow(index, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && index === rows.length - 1) {
                  e.preventDefault();
                  addRow();
                }
              }}
              onFocus={() => setFocusLast(false)}
              autoFocus={focusLast && index === rows.length - 1}
              placeholder={placeholder}
              disabled={disabled}
              className="flex-1"
              inputClassName="font-mono"
            />
            <button
              type="button"
              onClick={() => removeRow(index)}
              disabled={disabled || rows.length <= 1}
              title="Remove endpoint"
              aria-label="Remove endpoint"
              className="shrink-0 rounded-[10px] p-1.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-black/10 py-2 text-xs font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10"
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
        {addLabel}
      </button>

      {error && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

EndpointUrlsInput.propTypes = {
  values: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
  hint: PropTypes.node,
  error: PropTypes.string,
  placeholder: PropTypes.string,
  addLabel: PropTypes.string,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};
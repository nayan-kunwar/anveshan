"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { searchTimezones, timezoneLabel, utcOffsetLabel } from "../lib/datetime";

interface TimezonePickerProps {
  value: string;
  options: string[];
  onChange: (timeZone: string) => void;
}

const MAX_ROWS = 50;

/**
 * Searchable timezone combobox. Typing filters friendly labels
 * ("India — Asia/Kolkata (IST, UTC+5:30)") by country, city, IANA
 * name, abbreviation, or offset; picking commits the raw IANA value.
 * Free text stays editable — validity is enforced at Save time.
 */
export default function TimezonePicker({
  value,
  options,
  onChange,
}: TimezonePickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(
    () => searchTimezones(options, value).slice(0, MAX_ROWS),
    [options, value],
  );

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function commit(tz: string): void {
    onChange(tz);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (results.length === 0 ? 0 : (h + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) =>
        results.length === 0 ? 0 : (h - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      if (open && results[highlight]) {
        event.preventDefault();
        commit(results[highlight].value);
      } else {
        setOpen(true);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const collapsedLabel = timezoneLabel(value)?.text ?? value;
  // Collapsed display mirrors the mockup: raw IANA while editing,
  // compact "Zone (offset)" once blurred.
  const offset = utcOffsetLabel(value);
  const displayValue =
    focused || !value || !offset || offset === value ? value : `${value} (${offset})`;

  return (
    <div className="combo" ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={displayValue}
        title={collapsedLabel}
        placeholder="Type country, city, or zone — e.g. India"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 ? (
        <ul id={listId} role="listbox" className="combo-list">
          {results.map((r, i) => (
            <li
              key={r.value}
              role="option"
              aria-selected={i === highlight}
              title={r.value}
              className={i === highlight ? "combo-item active" : "combo-item"}
              onMouseDown={(e) => {
                // Commit before the input blurs.
                e.preventDefault();
                commit(r.value);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {r.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

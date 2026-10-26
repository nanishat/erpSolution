"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";

type AccountOption = {
  id: string;
  code: string;
  name: string;
};

export function AccountPicker({
  options,
  value,
  onChange,
  id,
  placeholder = "Search accounts",
  disabled = false,
}: {
  options: AccountOption[];
  value: string;
  onChange: (accountId: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.id === value);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter(
      (option) =>
        option.code.toLocaleLowerCase().includes(normalizedQuery) ||
        option.name.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [options, query]);

  const selectOption = (option: AccountOption) => {
    onChange(option.id);
    setQuery("");
    setIsOpen(false);
    setIsFocused(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && filtered.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current + 1) % filtered.length);
    } else if (event.key === "ArrowUp" && filtered.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Enter" && isOpen && filtered.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      selectOption(filtered[activeIndex] ?? filtered[0]);
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={isFocused ? query : selected ? `${selected.code} – ${selected.name}` : ""}
        placeholder={isFocused && selected ? `${selected.code} – ${selected.name}` : placeholder}
        onFocus={() => {
          setIsFocused(true);
          setIsOpen(true);
          setQuery("");
          setActiveIndex(0);
        }}
        onBlur={() => {
          setIsOpen(false);
          setIsFocused(false);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setIsOpen(true);
          onChange("");
        }}
        onKeyDown={handleKeyDown}
        data-line-cell
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:bg-muted disabled:text-muted-foreground"
      />
      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-card py-1 shadow-card"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matching accounts.</li>
          ) : (
            filtered.map((option, index) => (
              <li
                id={`${listId}-${index}`}
                key={option.id}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  index === activeIndex ? "bg-muted" : ""
                }`}
              >
                {option.code} – {option.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

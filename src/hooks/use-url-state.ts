"use client";

import { useCallback, useEffect, useState, type SetStateAction } from "react";

/**
 * Keys the open page keeps in the link. The layout clears them when another
 * page opens, so one page's search never follows the user to the next.
 */
const pageStateKeys = new Set<string>();

export function clearPageUrlState(url: URL): void {
  for (const key of pageStateKeys) url.searchParams.delete(key);
}

function readParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

function writeParam(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value === null || value === "") url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  const next = url.toString();
  if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
}

/**
 * useState that also lives in the page link (replaceState, no new history
 * entry): a refresh, a copied link or coming back keeps the search, filters
 * and page. The fallback value is left out of the link.
 */
function useUrlValue<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string,
): [T, (value: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = readParam(key);
    if (raw === null) return fallback;
    const parsed = parse(raw);
    return parsed === undefined ? fallback : parsed;
  });
  const fallbackText = serialize(fallback);

  useEffect(() => {
    pageStateKeys.add(key);
    return () => {
      pageStateKeys.delete(key);
    };
  }, [key]);

  const set = useCallback(
    (next: SetStateAction<T>) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(current) : next;
        const text = serialize(resolved);
        writeParam(key, text === fallbackText ? null : text);
        return resolved;
      });
    },
    [key, serialize, fallbackText],
  );

  return [value, set];
}

const asString = (raw: string) => raw;
const fromString = (value: string) => value;

export function useUrlState(key: string, fallback = "") {
  return useUrlValue<string>(key, fallback, asString, fromString);
}

const asPositiveInt = (raw: string) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : undefined;
};
const fromNumber = (value: number) => String(value);

export function useUrlNumberState(key: string, fallback = 1) {
  return useUrlValue<number>(key, fallback, asPositiveInt, fromNumber);
}

/** For a value from a fixed list (a status, a scope): anything else falls back. */
export function useUrlChoiceState<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const parse = useCallback((raw: string) => (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined, [allowed]);
  return useUrlValue<T>(key, fallback, parse, fromString as (value: T) => string);
}

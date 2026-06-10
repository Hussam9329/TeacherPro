"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type FilterValue = string | number | boolean | null | undefined;
export type FilterPresetValues = Record<string, FilterValue>;

type SavedFilterPreset = {
  name: string;
  values: FilterPresetValues;
};

type CustomFilterPresetsProps = {
  storageKey: string;
  currentFilters: FilterPresetValues;
  onApply: (values: FilterPresetValues) => void;
  onClear?: () => void;
};

function readPresets(storageKey: string): SavedFilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => item && typeof item.name === "string" && typeof item.values === "object",
    ) as SavedFilterPreset[];
  } catch {
    return [];
  }
}

function writePresets(storageKey: string, presets: SavedFilterPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(presets));
}

export function CustomFilterPresets({
  storageKey,
  currentFilters,
  onApply,
  onClear,
}: CustomFilterPresetsProps) {
  const [presets, setPresets] = useState<SavedFilterPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    setPresets(readPresets(storageKey));
  }, [storageKey]);

  const hasActiveFilter = useMemo(
    () => Object.values(currentFilters).some((value) => value !== "" && value !== null && value !== undefined && value !== false),
    [currentFilters],
  );

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      toast.error("اكتب اسم الفلتر المخصص أولاً");
      return;
    }
    const next = [
      ...presets.filter((preset) => preset.name !== name),
      { name, values: currentFilters },
    ];
    setPresets(next);
    writePresets(storageKey, next);
    setSelectedPreset(name);
    setPresetName("");
    toast.success("تم حفظ الفلتر المخصص");
  };

  const applyPreset = (name: string) => {
    setSelectedPreset(name);
    const preset = presets.find((item) => item.name === name);
    if (preset) onApply(preset.values);
  };

  const deletePreset = () => {
    if (!selectedPreset) return;
    const next = presets.filter((preset) => preset.name !== selectedPreset);
    setPresets(next);
    writePresets(storageKey, next);
    setSelectedPreset("");
    toast.success("تم حذف الفلتر المخصص");
  };

  return (
    <div className="rounded-2xl border border-dashed bg-muted/25 p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">الفلاتر المخصصة</Label>
          <div className="flex gap-2">
            <Input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="اسم الفلتر المخصص"
              className="h-9"
            />
            <Button type="button" size="sm" onClick={savePreset} disabled={!hasActiveFilter}>
              حفظ
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">تطبيق فلتر محفوظ</Label>
          <Select value={selectedPreset || "none"} onValueChange={(value) => value !== "none" && applyPreset(value)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="اختر فلتر" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">اختر فلتر</SelectItem>
              {presets.map((preset) => (
                <SelectItem key={preset.name} value={preset.name}>{preset.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onClear} disabled={!onClear || !hasActiveFilter}>
            تصفير
          </Button>
          <Button type="button" variant="ghost" size="sm" className="flex-1 text-destructive" onClick={deletePreset} disabled={!selectedPreset}>
            حذف
          </Button>
        </div>
      </div>
    </div>
  );
}

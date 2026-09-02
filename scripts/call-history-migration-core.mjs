export const CALL_STUDENT_NOTE_CATEGORY = "call-student-note";
export const VALID_CALL_STATUSES = ["تم الاتصال", "لم يرد", "الرقم خاطئ"];

const VALID_STATUS_SET = new Set(VALID_CALL_STATUSES);

function text(value) {
  return String(value ?? "");
}

function trimmed(value) {
  return text(value).trim();
}

function timestamp(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function rowOrderAscending(a, b) {
  const timeDiff = timestamp(a.createdAt) - timestamp(b.createdAt);
  if (timeDiff !== 0) return timeDiff;
  return text(a.id).localeCompare(text(b.id));
}

function rowOrderDescending(a, b) {
  return rowOrderAscending(b, a);
}

export function isExamCallRow(row) {
  return Boolean(
    trimmed(row?.studentId) &&
      trimmed(row?.examId) &&
      text(row?.category) !== CALL_STUDENT_NOTE_CATEGORY,
  );
}

export function isLegacyCallCategory(category) {
  const value = text(category);
  return value === "absent" || value.startsWith("grade:");
}

export function logicalCallIdentityKey(studentId, examId) {
  return `${text(studentId)}::${text(examId)}`;
}

export function effectiveCallStatus(row) {
  const stored = trimmed(row?.status);
  if (VALID_STATUS_SET.has(stored)) {
    return { status: stored, unsupportedStatus: null };
  }
  if (stored) {
    return { status: "", unsupportedStatus: stored };
  }
  if (Boolean(row?.completed)) {
    return { status: "تم الاتصال", unsupportedStatus: null };
  }
  return { status: "", unsupportedStatus: null };
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map(trimmed).filter(Boolean))];
}

function latestNonEmpty(rows, field) {
  for (const row of [...rows].sort(rowOrderDescending)) {
    const value = trimmed(row?.[field]);
    if (value) return value;
  }
  return "";
}

function latestCompletedAt(rows) {
  const candidates = rows
    .filter((row) => effectiveCallStatus(row).status === "تم الاتصال")
    .map((row) => row.completedAt)
    .filter(Boolean)
    .sort((a, b) => timestamp(b) - timestamp(a));
  return candidates[0] ?? null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function analyzeDuplicateGroup(rows, resolution) {
  const orderedRows = [...rows].sort(rowOrderAscending);
  const survivor = orderedRows[0];
  const statuses = [];
  const unsupportedStatuses = [];
  const completedMismatches = [];

  for (const row of orderedRows) {
    const effective = effectiveCallStatus(row);
    if (effective.status) statuses.push(effective.status);
    if (effective.unsupportedStatus) unsupportedStatuses.push(effective.unsupportedStatus);
    if (Boolean(row.completed) !== (effective.status === "تم الاتصال")) {
      completedMismatches.push(row.id);
    }
  }

  const distinctStatuses = [...new Set(statuses)];
  const distinctUnsupportedStatuses = [...new Set(unsupportedStatuses)];
  const distinctNotes = uniqueNonEmpty(orderedRows.map((row) => row.notes));
  const distinctPhones = uniqueNonEmpty(orderedRows.map((row) => row.phone));
  const distinctTargets = uniqueNonEmpty(orderedRows.map((row) => row.target));
  const categories = [...new Set(orderedRows.map((row) => text(row.category)))];

  const statusNeedsResolution =
    distinctStatuses.length > 1 || distinctUnsupportedStatuses.length > 0;
  const notesNeedResolution = distinctNotes.length > 1;
  const resolutionErrors = [];

  let finalStatus = distinctStatuses[0] || "";
  if (statusNeedsResolution) {
    if (!hasOwn(resolution, "status")) {
      finalStatus = null;
    } else {
      const requestedStatus = trimmed(resolution.status);
      if (requestedStatus && !VALID_STATUS_SET.has(requestedStatus)) {
        resolutionErrors.push(
          `status must be one of: ${["(empty)", ...VALID_CALL_STATUSES].join(", ")}`,
        );
        finalStatus = null;
      } else {
        finalStatus = requestedStatus;
      }
    }
  }

  let finalNotes = distinctNotes[0] || "";
  if (notesNeedResolution) {
    if (!hasOwn(resolution, "notes")) {
      finalNotes = null;
    } else {
      finalNotes = text(resolution.notes).trim();
    }
  }

  const conflictTypes = [];
  if (distinctUnsupportedStatuses.length > 0) conflictTypes.push("UNSUPPORTED_STATUS");
  if (distinctStatuses.length > 1) conflictTypes.push("STATUS_CONFLICT");
  if (distinctNotes.length > 1) conflictTypes.push("NOTE_CONFLICT");
  if (resolutionErrors.length > 0) conflictTypes.push("INVALID_RESOLUTION");

  const unresolved =
    finalStatus === null || finalNotes === null || resolutionErrors.length > 0;

  return {
    identityKey: logicalCallIdentityKey(survivor.studentId, survivor.examId),
    studentId: survivor.studentId,
    examId: survivor.examId,
    rowCount: orderedRows.length,
    rows: orderedRows,
    rowIds: orderedRows.map((row) => row.id),
    survivorId: survivor.id,
    deleteIds: orderedRows.slice(1).map((row) => row.id),
    categories,
    legacyRowCount: orderedRows.filter((row) => isLegacyCallCategory(row.category)).length,
    distinctStatuses,
    unsupportedStatuses: distinctUnsupportedStatuses,
    distinctNotes,
    metadataWarnings: {
      phoneConflict: distinctPhones.length > 1,
      targetConflict: distinctTargets.length > 1,
      completedFlagMismatchIds: completedMismatches,
    },
    conflictTypes,
    unresolved,
    resolutionApplied: Boolean(
      resolution && (hasOwn(resolution, "status") || hasOwn(resolution, "notes")),
    ),
    resolutionErrors,
    merge: unresolved
      ? null
      : {
          status: finalStatus,
          completed: finalStatus === "تم الاتصال",
          completedAt: finalStatus === "تم الاتصال" ? latestCompletedAt(orderedRows) : null,
          notes: finalNotes,
          target: latestNonEmpty(orderedRows, "target"),
          phone: latestNonEmpty(orderedRows, "phone"),
          survivingCategory: text(survivor.category),
        },
  };
}

export function buildCallHistoryMigrationPlan(rows, resolutions = {}) {
  const examCallRows = rows.filter(isExamCallRow);
  const groups = new Map();

  for (const row of examCallRows) {
    const internalKey = `${text(row.studentId)}\u0000${text(row.examId)}`;
    if (!groups.has(internalKey)) groups.set(internalKey, []);
    groups.get(internalKey).push(row);
  }

  const duplicateGroups = [];
  for (const groupRows of groups.values()) {
    if (groupRows.length < 2) continue;
    const key = logicalCallIdentityKey(groupRows[0].studentId, groupRows[0].examId);
    duplicateGroups.push(analyzeDuplicateGroup(groupRows, resolutions[key] || {}));
  }
  duplicateGroups.sort((a, b) => a.identityKey.localeCompare(b.identityKey));

  const unresolvedGroups = duplicateGroups.filter((group) => group.unresolved);
  const resolvableGroups = duplicateGroups.filter((group) => !group.unresolved);
  const legacyRows = examCallRows.filter((row) => isLegacyCallCategory(row.category));
  const noteRows = rows.filter((row) => text(row.category) === CALL_STUDENT_NOTE_CATEGORY);
  const nonExamRows = rows.filter(
    (row) => text(row.category) !== CALL_STUDENT_NOTE_CATEGORY && !trimmed(row.examId),
  );

  const legacyCategorySet = new Set(legacyRows.map((row) => text(row.category)));
  const legacyAbsentRows = legacyRows.filter((row) => text(row.category) === "absent").length;
  const legacyGradeRows = legacyRows.length - legacyAbsentRows;

  const resolutionTemplate = {};
  for (const group of unresolvedGroups) {
    const entry = {
      _instructions: "Review the options, then add explicit status and/or notes fields. Underscore-prefixed fields are ignored by apply.",
    };
    if (
      group.conflictTypes.includes("STATUS_CONFLICT") ||
      group.conflictTypes.includes("UNSUPPORTED_STATUS")
    ) {
      entry._statusOptions = ["", ...group.distinctStatuses];
      if (group.unsupportedStatuses.length) {
        entry._unsupportedStatuses = group.unsupportedStatuses;
      }
    }
    if (group.conflictTypes.includes("NOTE_CONFLICT")) {
      entry._noteOptions = group.distinctNotes;
    }
    resolutionTemplate[group.identityKey] = entry;
  }

  return {
    summary: {
      totalRows: rows.length,
      examCallRows: examCallRows.length,
      logicalExamCalls: groups.size,
      manualStudentNoteRows: noteRows.length,
      nonExamCallRows: nonExamRows.length,
      legacyRows: legacyRows.length,
      legacyDistinctCategoryKeys: legacyCategorySet.size,
      legacyCategoryKinds: {
        absent: legacyAbsentRows,
        grade: legacyGradeRows,
      },
      duplicateGroups: duplicateGroups.length,
      duplicateRowsRemovable: duplicateGroups.reduce(
        (sum, group) => sum + group.deleteIds.length,
        0,
      ),
      safeMergeGroups: resolvableGroups.length,
      unresolvedConflictGroups: unresolvedGroups.length,
      statusConflictGroups: duplicateGroups.filter((group) =>
        group.conflictTypes.includes("STATUS_CONFLICT"),
      ).length,
      unsupportedStatusGroups: duplicateGroups.filter((group) =>
        group.conflictTypes.includes("UNSUPPORTED_STATUS"),
      ).length,
      noteConflictGroups: duplicateGroups.filter((group) =>
        group.conflictTypes.includes("NOTE_CONFLICT"),
      ).length,
      metadataWarningGroups: duplicateGroups.filter(
        (group) =>
          group.metadataWarnings.phoneConflict ||
          group.metadataWarnings.targetConflict ||
          group.metadataWarnings.completedFlagMismatchIds.length > 0,
      ).length,
      rowsAfterSuccessfulMigration:
        rows.length - duplicateGroups.reduce((sum, group) => sum + group.deleteIds.length, 0),
    },
    duplicateGroups,
    unresolvedGroups,
    resolvableGroups,
    resolutionTemplate,
  };
}

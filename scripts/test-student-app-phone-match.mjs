#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  findStudentsByPhone,
  normalizeIraqiPhone,
  phoneDigits,
  phoneMatchRanks,
} from "../src/lib/student-app/phone-match.ts";

test("digits: Arabic-Indic digits, separators and leading plus", () => {
  assert.equal(phoneDigits("٠٧٧٠ ١٢٣-٤٥٦٧"), "07701234567");
  assert.equal(phoneDigits("+9647701234567"), "9647701234567");
  assert.equal(phoneDigits("abc"), "");
  assert.equal(phoneDigits("07a"), "");
});

test("normalizeIraqiPhone folds country prefixes to 07", () => {
  assert.equal(normalizeIraqiPhone("+964 770 123 4567"), "07701234567");
  assert.equal(normalizeIraqiPhone("009647701234567"), "07701234567");
  assert.equal(normalizeIraqiPhone("7701234567"), "07701234567");
  assert.equal(normalizeIraqiPhone("12345"), "12345");
});

test("iraqi variants: ranks mirror the bot", () => {
  const ranks = phoneMatchRanks("+964 770 123 4567");
  for (const v of ["07701234567", "7701234567", "9647701234567", "+9647701234567", "009647701234567"]) {
    assert.ok(ranks.has(v), `missing ${v}`);
  }
  assert.equal(ranks.get("9647701234567"), 0);
  assert.equal(ranks.get("+9647701234567"), 0);
  assert.equal(ranks.get("009647701234567"), 1);
  assert.equal(ranks.get("07701234567"), 2);
});

test("invalid input yields no ranks", () => {
  assert.equal(phoneMatchRanks("07a").size, 0);
  assert.equal(phoneMatchRanks("").size, 0);
});

function fakeClient(rows) {
  return {
    student: {
      async findMany({ where }) {
        const [field, cond] = Object.entries(where)[0];
        const values = cond.in;
        return rows
          .filter((r) => values.includes(r[field]))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      },
    },
  };
}

const student = (id, extra) => ({ id, name: id, code: id.toUpperCase(), status: "نشط", phone: null, phoneKey: null, parentPhone: null, ...extra });

test("selection: phoneKey exact beats parent phone", async () => {
  const client = fakeClient([
    student("a", { phoneKey: "07701234567", phone: "0770 123 4567" }),
    student("b", { parentPhone: "07701234567" }),
  ]);
  const found = await findStudentsByPhone(client, phoneMatchRanks("07701234567"));
  assert.deepEqual(found.map((s) => s.id), ["a"]);
});

test("selection: parent phone used only when no student phone matches", async () => {
  const client = fakeClient([
    student("x", { parentPhone: "07809876543" }),
    student("y", { parentPhone: "07809876543" }),
    student("z", { phoneKey: "07701234567" }),
  ]);
  const found = await findStudentsByPhone(client, phoneMatchRanks("٠٧٨٠٩٨٧٦٥٤٣"));
  assert.deepEqual(found.map((s) => s.id), ["x", "y"]);
});

test("selection: raw phone column matches when phoneKey differs", async () => {
  const client = fakeClient([student("r", { phoneKey: "0000", phone: "+9647701234567" })]);
  const found = await findStudentsByPhone(client, phoneMatchRanks("07701234567"));
  assert.deepEqual(found.map((s) => s.id), ["r"]);
});

test("selection: empty ranks returns nothing without querying", async () => {
  const client = { student: { async findMany() { throw new Error("should not query"); } } };
  assert.deepEqual(await findStudentsByPhone(client, new Map()), []);
});

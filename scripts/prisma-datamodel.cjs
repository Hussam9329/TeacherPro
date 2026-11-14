// The full Prisma datamodel of prisma/schema.prisma (relations, isRequired,
// isUpdatedAt, dbName), read with Prisma's own schema parser.
//
// The client uses engineType "client", whose runtime `Prisma.dmmf` keeps only
// names and types. Scripts that check the database against the schema, or
// build a Prisma-shaped client over PostgreSQL in tests, read the datamodel
// from here so their checks don't silently weaken.
// @prisma/prisma-schema-wasm is pinned to the engines version of the installed
// prisma package (see @prisma/engines-version); upgrade them together.
const fs = require("node:fs");
const path = require("node:path");
const { get_dmmf } = require("@prisma/prisma-schema-wasm");

const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");
const { datamodel } = JSON.parse(get_dmmf(JSON.stringify({ prismaSchema: [["schema.prisma", schema]] })));

module.exports = { datamodel };

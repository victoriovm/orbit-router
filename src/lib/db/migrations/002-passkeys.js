import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 2,
  name: "passkeys",
  up(db) {
    const definition = TABLES.passkeys;
    db.exec(buildCreateTableSql("passkeys", definition));
    for (const indexSql of definition.indexes || []) db.exec(indexSql);
  },
};

export default migration;

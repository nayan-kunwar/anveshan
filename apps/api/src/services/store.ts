import type { Db } from "@anveshan/database";
import {
  findProgramById,
  listAssets,
  listChanges,
  listPrograms,
  listRecentChanges,
} from "@anveshan/database";
import type { ProgramStore } from "./programs.js";

/** Production adapter: ProgramStore backed by Drizzle repositories. */
export function createDrizzleProgramStore(db: Db): ProgramStore {
  return {
    listPrograms: (page, pageSize, q, sort) => listPrograms(db, page, pageSize, q, sort),
    findProgramById: (id) => findProgramById(db, id),
    listAssets: (programId, scope, page, pageSize) =>
      listAssets(db, programId, scope, page, pageSize),
    listChanges: (programId, since, page, pageSize) =>
      listChanges(db, programId, since, page, pageSize),
    listRecentChanges: (since, type, page, pageSize) =>
      listRecentChanges(db, { since, type, page, pageSize }),
  };
}

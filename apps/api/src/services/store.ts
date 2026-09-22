import type { Db } from "@anveshan/database";
import {
  findProgramById,
  listAssets,
  listChanges,
  listPrograms,
} from "@anveshan/database";
import type { ProgramStore } from "./programs.js";

/** Production adapter: ProgramStore backed by Drizzle repositories. */
export function createDrizzleProgramStore(db: Db): ProgramStore {
  return {
    listPrograms: (page, pageSize, q) => listPrograms(db, page, pageSize, q),
    findProgramById: (id) => findProgramById(db, id),
    listAssets: (programId, scope, page, pageSize) =>
      listAssets(db, programId, scope, page, pageSize),
    listChanges: (programId, since, page, pageSize) =>
      listChanges(db, programId, since, page, pageSize),
  };
}

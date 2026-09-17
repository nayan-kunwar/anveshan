import express from "express";
import type { Logger } from "pino";
import { createProgramController } from "./controllers/programs.js";
import { asyncRoute, errorHandler, notFoundHandler } from "./middleware.js";
import type { ProgramStore } from "./services/programs.js";

export interface AppDeps {
  store: ProgramStore;
  logger: Logger;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const programs = createProgramController(deps.store);
  app.get("/api/v1/programs", asyncRoute(programs.listPrograms));
  app.get("/api/v1/programs/:id", asyncRoute(programs.getProgram));
  app.get("/api/v1/programs/:id/assets", asyncRoute(programs.listAssets));
  app.get("/api/v1/programs/:id/changes", asyncRoute(programs.listChanges));

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}

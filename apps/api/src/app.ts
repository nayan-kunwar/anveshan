import type { AppConfig } from "@anveshan/config";
import type { Database } from "@anveshan/database";
import type { SendMailFn } from "@anveshan/notifications";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { createRequireAdminKey } from "./admin/auth.js";
import { createAdminRoutes } from "./admin/routes.js";
import type { AdminService } from "./admin/routes.js";
import { createRequireSession } from "./auth/middleware.js";
import { createEmailRateLimiter, createIpRateLimiter } from "./auth/rate-limit.js";
import { createAuthRoutes } from "./auth/routes.js";
import { createSubscriptionRoutes } from "./subscriptions/routes.js";
import { createProgramController } from "./controllers/programs.js";
import { asyncRoute, errorHandler, notFoundHandler } from "./middleware.js";
import type { ProgramStore } from "./services/programs.js";

export interface AppDeps {
  store: ProgramStore;
  logger: Logger;
  /** Auth routes mount only when all three are present (api.test.ts omits them). */
  db?: Database | undefined;
  config?: AppConfig | undefined;
  sendMail?: SendMailFn | undefined;
  /** Admin routes mount only when this plus config are present. */
  adminService?: AdminService | undefined;
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

  if (deps.db && deps.config && deps.sendMail) {
    const authDeps = {
      db: deps.db,
      config: deps.config,
      logger: deps.logger,
      sendMail: deps.sendMail,
      ipLimiter: createIpRateLimiter(),
      emailLimiter: createEmailRateLimiter(),
    };
    const auth = createAuthRoutes(authDeps);
    const requireSession = createRequireSession({
      db: deps.db,
      sessionSecret: deps.config.SESSION_SECRET,
    });
    // Express middleware must return void; requireSession handles rejections.
    const requireSessionHandler = (
      req: Request,
      res: Response,
      next: NextFunction,
    ): void => {
      void requireSession(req, res, next);
    };
    app.post("/api/v1/auth/request-magic-link", asyncRoute(auth.requestMagicLink));
    app.post("/api/v1/auth/verify", asyncRoute(auth.verify));
    app.get("/api/v1/auth/me", requireSessionHandler, asyncRoute(auth.me));
    app.post("/api/v1/auth/logout", requireSessionHandler, asyncRoute(auth.logout));
    app.post("/api/v1/unsubscribe", asyncRoute(auth.unsubscribe));

    const subscriptions = createSubscriptionRoutes({ db: deps.db });
    app.get(
      "/api/v1/subscriptions",
      requireSessionHandler,
      asyncRoute(subscriptions.getSubscription),
    );
    app.put(
      "/api/v1/subscriptions",
      requireSessionHandler,
      asyncRoute(subscriptions.putSubscription),
    );
    app.get(
      "/api/v1/subscriptions/watches",
      requireSessionHandler,
      asyncRoute(subscriptions.listWatches),
    );
    app.post(
      "/api/v1/subscriptions/watches",
      requireSessionHandler,
      asyncRoute(subscriptions.addWatch),
    );
    app.delete(
      "/api/v1/subscriptions/watches/:programId",
      requireSessionHandler,
      asyncRoute(subscriptions.removeWatch),
    );
  }

  if (deps.adminService && deps.config) {
    const requireAdminKey = createRequireAdminKey({
      adminKey: deps.config.ADMIN_API_KEY,
      logger: deps.logger,
    });
    const admin = createAdminRoutes(deps.adminService);
    app.post(
      "/api/v1/admin/collections",
      requireAdminKey,
      asyncRoute(admin.triggerCollections),
    );
    app.get(
      "/api/v1/admin/collections",
      requireAdminKey,
      asyncRoute(admin.listCollections),
    );
    app.get(
      "/api/v1/admin/collections/:id",
      requireAdminKey,
      asyncRoute(admin.getCollection),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}

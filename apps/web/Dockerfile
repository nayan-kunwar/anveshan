FROM node:24.22.1-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile && pnpm --filter @anveshan/web build

FROM node:24.22.1-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=build /app/packages ./packages
# --ignore-scripts: the root prepare hook runs husky, a devDependency that
# is absent in a production install.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
EXPOSE 3001
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3001"]

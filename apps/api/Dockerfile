FROM node:24.22.1-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile && pnpm --filter @anveshan/api... build

FROM node:24.22.1-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages ./packages
# --ignore-scripts: the root prepare hook runs husky, a devDependency that
# is absent in a production install.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]

const root = (file: string): string => new URL(file, import.meta.url).pathname;

/** Shared @anveshan/* → src aliases for Vitest (dev/test run from source). */
export const workspaceAliases: Record<string, string> = {
  "@anveshan/config": root("./packages/config/src/index.ts"),
  "@anveshan/domain": root("./packages/domain/src/index.ts"),
  "@anveshan/database": root("./packages/database/src/index.ts"),
  "@anveshan/collector": root("./packages/collector/src/index.ts"),
  "@anveshan/notifications": root("./packages/notifications/src/index.ts"),
};

import type { AppConfig } from "@anveshan/config";
import {
  isAuthEmailEnabled,
  requireMagicLinkSecrets,
  requireUnsubscribeSecret,
} from "@anveshan/config";
import type { Database, UserRow } from "@anveshan/database";
import {
  consumeMagicLinkToken,
  deleteSessionByHash,
  findUserById,
  findValidMagicLinkToken,
  insertMagicLinkToken,
  insertSession,
  invalidateUserTokens,
  setUnsubscribed,
  upsertUserByEmail,
  verifyUserEmail,
} from "@anveshan/database";
import type { SendMailFn } from "@anveshan/notifications";
import type { Logger } from "pino";
import { AppError } from "../errors.js";
import {
  hashMagicLinkToken,
  hashSessionToken,
  newRawToken,
  verifyUnsubscribe,
} from "./tokens.js";

export interface AuthServiceDeps {
  db: Database;
  config: AppConfig;
  logger: Logger;
  sendMail: SendMailFn;
}

export interface UserDto {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export function toUserDto(
  user: Pick<UserRow, "id" | "email" | "emailVerifiedAt" | "createdAt">,
): UserDto {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

function magicLinkEmailBody(callbackUrl: string, expiryMin: number): string {
  return [
    "Hi,",
    "",
    "Sign in to Anveshan with this link:",
    callbackUrl,
    "",
    `This link expires in ${expiryMin} minutes. If you didn't request it, ignore this email.`,
  ].join("\n");
}

/**
 * Always resolves (no email oracle). SMTP timeout/error is logged,
 * never thrown to the client.
 */
export async function requestMagicLink(
  deps: AuthServiceDeps,
  email: string,
): Promise<void> {
  const { magicLinkSecret } = requireMagicLinkSecrets(deps.config);
  const user = await upsertUserByEmail(deps.db, email);
  await invalidateUserTokens(deps.db, user.id);
  const rawToken = newRawToken();
  await insertMagicLinkToken(
    deps.db,
    user.id,
    hashMagicLinkToken(rawToken, magicLinkSecret),
    new Date(Date.now() + deps.config.MAGIC_LINK_EXPIRY),
  );
  if (!isAuthEmailEnabled(deps.config)) {
    deps.logger.info({ userId: user.id }, "auth email disabled; magic link not sent");
    return;
  }
  const callbackUrl = `${deps.config.FRONTEND_URL}/auth/callback?token=${rawToken}`;
  try {
    await deps.sendMail({
      to: user.email,
      subject: "[Anveshan] Sign in to Anveshan",
      text: magicLinkEmailBody(
        callbackUrl,
        Math.round(deps.config.MAGIC_LINK_EXPIRY / 60_000),
      ),
    });
  } catch (error) {
    deps.logger.error({ err: error, userId: user.id }, "magic-link email failed");
  }
}

export interface VerifiedSession {
  user: UserDto;
  sessionToken: string;
}

export async function verifyMagicLink(
  deps: AuthServiceDeps,
  rawToken: string,
): Promise<VerifiedSession> {
  const { magicLinkSecret, sessionSecret } = requireMagicLinkSecrets(deps.config);
  const token = await findValidMagicLinkToken(
    deps.db,
    hashMagicLinkToken(rawToken, magicLinkSecret),
  );
  if (!token) {
    throw AppError.invalidToken();
  }
  await consumeMagicLinkToken(deps.db, token.id);
  await verifyUserEmail(deps.db, token.userId);
  const sessionToken = newRawToken();
  await insertSession(
    deps.db,
    token.userId,
    hashSessionToken(sessionToken, sessionSecret),
    new Date(Date.now() + deps.config.SESSION_EXPIRY),
  );
  const user = await findUserById(deps.db, token.userId);
  if (!user) {
    throw AppError.invalidToken();
  }
  return { user: toUserDto(user), sessionToken };
}

export async function logoutSession(
  deps: AuthServiceDeps,
  rawSessionToken: string | undefined,
): Promise<void> {
  if (!rawSessionToken || !deps.config.SESSION_SECRET) return;
  await deleteSessionByHash(
    deps.db,
    hashSessionToken(rawSessionToken, deps.config.SESSION_SECRET),
  );
}

export async function unsubscribeUser(
  deps: AuthServiceDeps,
  userId: string,
  token: string,
): Promise<void> {
  const secret = requireUnsubscribeSecret(deps.config);
  if (!verifyUnsubscribe(userId, token, secret)) {
    throw AppError.invalidToken();
  }
  await setUnsubscribed(deps.db, userId);
}

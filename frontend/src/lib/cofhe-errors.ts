/**
 * Typed handling for @cofhe/sdk errors.
 *
 * The SDK throws CofheError objects with a stable `code` (CofheErrorCode). Per
 * Fhenix's error-handling guide we branch on the code, not on message text.
 * Codes are compared as strings so this module doesn't import the SDK (which
 * ships WASM and is only loaded client-side).
 */

type CofheErrorLike = { code?: unknown; message?: unknown };

export function cofheErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as CofheErrorLike).code;
  return typeof code === "string" ? code : undefined;
}

/** ACP problems that a fresh self ACP fixes. */
export function isRecoverableAcpError(err: unknown): boolean {
  const code = cofheErrorCode(err);
  return code === "ACP_EXPIRED" || code === "ACP_NOT_FOUND" || code === "ACP_REVOKED" || code === "ACP_INVALID";
}

/** One plain sentence for an SDK error, or undefined if it isn't one we know. */
export function describeCofheError(err: unknown): string | undefined {
  switch (cofheErrorCode(err)) {
    case "ACP_DENIED":
      return "Fhenix refused to decrypt this for your wallet — it isn't a value your wallet is allowed to read.";
    case "ACP_EXPIRED":
    case "ACP_REVOKED":
    case "ACP_INVALID":
    case "ACP_NOT_FOUND":
      return "Your access permission needs to be renewed. Try again and sign the new one.";
    case "NOT_PUBLICLY_ALLOWED":
      return "This value isn't public yet. It becomes decryptable once the contract publishes it (for an auction, after it's closed).";
    case "CT_NOT_FOUND":
      return "Fhenix hasn't indexed this value yet. Wait a few seconds and try again.";
    case "ZK_PACK_FAILED":
      return "Encryption failed in the browser. Reload the page and try again.";
    case "ZK_VERIFY_FAILED":
      return "Fhenix rejected the encrypted input. Reload the page and try again.";
    default:
      return undefined;
  }
}

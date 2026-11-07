// initData-авторизация Telegram Mini App (HMAC, как в Ногтях/ViTuCoin).
import type { Env } from "./types";

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
const enc = (s: string) => new TextEncoder().encode(s);

export async function verifyInitData(env: Env, initData: string): Promise<TgUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  // data-check-string: отсортированные ключи, объединённые \n
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  // КЛЮЧЕВАЯ ОСОБЕННОСТЬ: WebAppData-ключ — HMAC от пустоты с ключом SHA256(bot_token)? Нет:
  // правильная схема: secret = HMAC_SHA256(key="WebAppData", message=bot_token)
  const msgKey = await crypto.subtle.importKey(
    "raw", enc("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secret = await crypto.subtle.sign("HMAC", msgKey, enc(env.BOT_TOKEN));
  const sigKey = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", sigKey, enc(dataCheckString));
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (sigHex !== hash) return null;
  // auth_date не старше 24 часов
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  const userRaw = params.get("user");
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw) as TgUser;
  } catch {
    return null;
  }
}

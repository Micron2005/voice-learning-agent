import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { Request } from "express";
import { Store, requireThat } from "./store.js";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const opaque = () => randomBytes(32).toString("base64url");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function createOperator(store: Store, email: string, password: string) {
  requireThat(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      email.length <= 254 &&
      password.length >= 16 &&
      password.length <= 256,
    "credentials",
    "Use a valid email and a 16–256 character password.",
  );
  const id = randomUUID();
  store.db
    .prepare("INSERT INTO operators VALUES (?,?,?)")
    .run(id, email.toLowerCase(), passwordHash(password));
  return id;
}
export function session(store: Store, req: Request) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("voice_session="))
    ?.slice(14);
  const s = store.db
    .prepare("SELECT * FROM sessions WHERE hash=? AND expires>?")
    .get(hash(cookie ?? ""), Date.now());
  requireThat(s, "unauthenticated", "Sign in to continue.", 401);
  return s as { hash: string; owner: string; csrf: string; expires: number };
}
export function login(store: Store, email: string, password: string) {
  const u = store.db
    .prepare("SELECT * FROM operators WHERE email=?")
    .get(email.toLowerCase()) as any;
  const [salt, expected] = (
    u?.password ?? passwordHash("dummy account password")
  ).split(":");
  const actual = scryptSync(password, salt, 64),
    target = Buffer.from(expected, "hex");
  requireThat(
    u && actual.length === target.length && timingSafeEqual(actual, target),
    "credentials",
    "Email or password is incorrect.",
    401,
  );
  const token = opaque(),
    csrf = opaque();
  store.db
    .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
    .run(hash(token), u.id, csrf, Date.now() + 12 * 60 * 60_000);
  return { token, csrf, owner: u.id };
}

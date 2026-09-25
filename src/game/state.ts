/** Netplay resync: copy the plain gameplay fields of the fighters and the duel in and out. */
import * as THREE from "three";
/** Plain gameplay fields of an object (numbers, strings, flags, vectors, plain data). */
export function saveFields(o: object, skip: string[], extra: Record<string, unknown> = {}, only?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = o as Record<string, unknown>;
  for (const k of only ?? Object.keys(o)) {
    const v = src[k];
    if (skip.includes(k) || typeof v === "function" || v === undefined) continue;
    out[k] = v instanceof THREE.Vector3 ? { v3: [v.x, v.y, v.z] } : v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v));
  }
  return { ...out, ...extra };
}

export function loadFields(o: object, src: Record<string, unknown>): void {
  const t = o as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    if (!(k in t) || typeof t[k] === "function") continue;
    const cur = t[k];
    if (cur instanceof THREE.Vector3) {
      const a = (v as { v3: number[] }).v3;
      cur.set(a[0], a[1], a[2]);
    } else t[k] = v;
  }
}

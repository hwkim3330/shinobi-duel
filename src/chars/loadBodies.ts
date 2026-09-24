/**
 * Picks each fighter's body at startup. The procedural rig is always there first; if Mixamo
 * files for a character exist (converted GLB, or raw FBX on the dev server) and load with every
 * required clip, that SkinnedCharacter takes over. Otherwise nothing is requested at all, and
 * the loaders (GLTF/FBX) are never downloaded.
 */
import assets from "virtual:char-assets";
import type { Character } from "./Character";
import type { Fighter } from "./Fighter";
import { CHAR_MODE, SKINS } from "./skinnedConfig";

export type Who = "player" | "boss";

export function bodyMode(): "auto" | "procedural" | "skinned" {
  const q = new URLSearchParams(location.search).get("chars");
  return q === "procedural" || q === "skinned" || q === "auto" ? q : CHAR_MODE;
}

export function availableFiles(who: Who): { glb?: string; fbx?: Record<string, string> } | null {
  const glb = assets.glb[who];
  const fbx = assets.fbx[who];
  if (glb) return { glb };
  if (fbx) return { fbx };
  return null;
}

export async function loadBodies(sources: Record<Who, Character>, use: (who: Who, body: Fighter) => void): Promise<void> {
  if (bodyMode() === "procedural") return;
  const wanted = (["player", "boss"] as const).filter((w) => availableFiles(w));
  if (!wanted.length) return;
  const { SkinnedCharacter } = await import("./SkinnedCharacter");
  await Promise.all(
    wanted.map(async (who) => {
      const body = await SkinnedCharacter.load(SKINS[who], availableFiles(who)!, sources[who]);
      if (body) use(who, body);
    }),
  );
}

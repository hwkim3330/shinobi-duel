/** Virtual module from vite.config.ts: which character asset files exist right now. */
declare module "virtual:char-assets" {
  const assets: {
    /** Converted GLBs in public/assets/chars/ ("player" | "boss" → URL relative to base). */
    glb: Partial<Record<"player" | "boss", string>>;
    /** Mixamo FBX files per character (dev server only): clip name → URL. */
    fbx: Partial<Record<"player" | "boss", Record<string, string>>>;
  };
  export default assets;
}

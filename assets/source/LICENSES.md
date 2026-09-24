# Character source assets

Everything here is a downloaded source pack (not shipped as is). The game ships only the converted
`public/assets/chars/player.glb` / `boss.glb` built by `tools/blender/build_char.py`.

| asset | used for | source URL | license |
| --- | --- | --- | --- |
| Mixamo characters + animations (`../mixamo/player`, `../mixamo/boss`, listed with product ids in `../mixamo/MANIFEST.md`): Kachujin G Rosales (player), Paladin J Nordstrom (boss), Great Sword pack, Two Handed Sword, axe melee, reactions, Bayonet Stab, Drinking, Getting Up, Kneeling | shipped player / boss bodies (primary) | https://www.mixamo.com (downloaded by the project owner with their Adobe account) | Adobe Mixamo terms: royalty-free for personal, commercial and non-profit projects incl. games and videos; the raw files may not be redistributed on their own. https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html |
| Universal Animation Library [Standard] (`ual1/`) | fallback pipeline test only (not shipped) | https://quaternius.itch.io/universal-animation-library · https://quaternius.com/packs/universalanimationlibrary.html | CC0 1.0 (License.txt in the pack) |
| Universal Animation Library 2 [Standard] (`ual2/`) | fallback pipeline test only (not shipped) | https://quaternius.itch.io/universal-animation-library-2 · https://quaternius.com/packs/universalanimationlibrary2.html | CC0 1.0 (License.txt in the pack) |
| Universal Base Characters [Standard] (`ubc/`) | fallback pipeline test only (not shipped) | https://quaternius.itch.io/universal-base-characters | CC0 1.0 (License.txt in the pack) |
| Modular Character Outfits – Fantasy [Standard] (`outfits/`) | evaluated, not used | https://quaternius.itch.io/modular-character-outfits-fantasy | CC0 1.0 |

CC0 assets allow any use (public web deploy, YouTube videos, commercial) with no attribution
required; Quaternius is credited anyway. `_ual_build/` holds the fallback GLBs built from the CC0
packs (drop them into `public/assets/chars/` to use them).

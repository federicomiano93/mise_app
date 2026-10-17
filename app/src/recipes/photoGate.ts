import type { DocData } from '../session/backend';

// Is the photograph reader switched on for this venue?
//
// ⚠️ OFF UNLESS THE FIELD SAYS true, and only a literal true. This is the opposite default to a SECTION, deliberately: a
// section missing from a venue's document means yes, because a part of the app added later must not switch itself off.
// This one spends money per tap, so a venue that never asked for it must never find it on. The function that actually
// refuses (functions/recipe-photo-model.js photoEnabled) reads it the same way.
export function recipePhotoOn(location: DocData | null): boolean {
  return location !== null && location.recipePhoto === true;
}

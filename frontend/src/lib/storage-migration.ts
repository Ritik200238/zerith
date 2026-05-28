/**
 * One-time localStorage migrator: sigil-* keys → zerith-* keys.
 *
 * Background: pre-rebrand the app namespaced everything under "sigil-".
 * Renaming on its own would orphan returning users' settings (their
 * dismissed onboarding, their sound preference, their notification log).
 * This module migrates each known key on first load and then sets a
 * marker so subsequent loads skip the work.
 *
 * Idempotent. Safe to call repeatedly. Tolerates localStorage being
 * unavailable (private mode, quota, SSR).
 */

const KEYS_TO_MIGRATE: Array<[string, string]> = [
  ["sigil-notifications", "zerith-notifications"],
  ["sigil-sound-enabled", "zerith-sound-enabled"],
  ["sigil-onboarding-seen", "zerith-onboarding-seen"],
  // sigil-onboarding-seen-v2 already maps 1:1 to zerith-onboarding-seen-v2;
  // OnboardingModal already writes the new key, so we only need the v1 path.
];

const MIGRATION_MARKER = "zerith-storage-migrated-v1";

export function migrateSigilToZerith(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(MIGRATION_MARKER) === "1") return;

    for (const [oldKey, newKey] of KEYS_TO_MIGRATE) {
      const oldVal = window.localStorage.getItem(oldKey);
      if (oldVal === null) continue;
      // Only write the new key if it's not already populated. Avoids
      // clobbering data the user wrote under the new namespace already.
      if (window.localStorage.getItem(newKey) === null) {
        window.localStorage.setItem(newKey, oldVal);
      }
      window.localStorage.removeItem(oldKey);
    }

    window.localStorage.setItem(MIGRATION_MARKER, "1");
  } catch {
    // localStorage unavailable — give up silently. Worst case the user
    // sees onboarding once more or loses a sound preference. Not fatal.
  }
}

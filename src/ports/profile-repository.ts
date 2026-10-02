import type { KitchenProfile } from '../domain/kitchen-profile.ts';

export interface ProfileRepository {
  /** Returns undefined until a profile has been saved. */
  load(): KitchenProfile | undefined;
  save(profile: KitchenProfile): void;
}

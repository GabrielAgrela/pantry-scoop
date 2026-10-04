import { DEFAULT_PROFILE, mergeProfile, type KitchenProfile } from '../domain/kitchen-profile.ts';
import type { ProfileRepository } from '../ports/profile-repository.ts';

export class ProfileService {
  private readonly repository: ProfileRepository;

  constructor(repository: ProfileRepository) {
    this.repository = repository;
  }

  /** Profiles saved before a setting existed get its default. */
  get(): KitchenProfile {
    const stored = this.repository.load();
    return stored ? { ...DEFAULT_PROFILE, ...stored, setupComplete: stored.setupComplete ?? true } : DEFAULT_PROFILE;
  }

  update(input: unknown): KitchenProfile {
    const profile = mergeProfile(this.get(), input);
    this.repository.save(profile);
    return profile;
  }

  reset(): KitchenProfile {
    this.repository.save(DEFAULT_PROFILE);
    return DEFAULT_PROFILE;
  }
}

import { mergeProfile, type KitchenProfile } from '../domain/kitchen-profile.ts';
import { defaultProfile, type LanguageCode } from '../domain/language.ts';
import type { ProfileRepository } from '../ports/profile-repository.ts';

export class ProfileService {
  private readonly repository: ProfileRepository;
  private readonly defaults: KitchenProfile;

  /** `language` is the interface language; a kitchen that was never saved starts with suggestions in it. */
  constructor(repository: ProfileRepository, language: LanguageCode = 'en') {
    this.repository = repository;
    this.defaults = defaultProfile(language);
  }

  /** Profiles saved before a setting existed get its default. */
  get(): KitchenProfile {
    const stored = this.repository.load();
    return stored ? { ...this.defaults, ...stored, setupComplete: stored.setupComplete ?? true } : this.defaults;
  }

  update(input: unknown): KitchenProfile {
    const profile = mergeProfile(this.get(), input);
    this.repository.save(profile);
    return profile;
  }

  reset(): KitchenProfile {
    this.repository.save(this.defaults);
    return this.defaults;
  }
}

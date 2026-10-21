export {
  GlossaryTermSchema,
  ProfileSchema,
  slugify,
  type GlossaryTerm,
  type IgnoredSuggestion,
  type Profile,
  type ProfileInput,
  type TermMatch,
  type TermSource,
} from './schema.js';
export { migrate, ProfileError } from './migrate.js';
export { defaultProfilesDir, ProfileStore, type ProfileListEntry } from './store.js';
export { toJson, toMarkdown } from './export.js';
export { LEGACY_SEED_PROFILES } from './seed.js';

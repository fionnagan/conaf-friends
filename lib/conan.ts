/**
 * Reference facts about Conan O'Brien himself — needed to compute age-relative
 * booking signals (e.g. "guests within 2 years of Conan's age", "guests 50
 * years younger than Conan"). A public figure's well-documented birth date,
 * not personal data about a private individual.
 */
export const CONAN_BIRTH_YEAR = 1963;
export const CONAN_BIRTH_DATE = '1963-04-18';

/** Conan's age as of a given date (defaults to now). */
export function getConanAge(asOf: Date = new Date()): number {
  const birth = new Date(CONAN_BIRTH_DATE);
  let age = asOf.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    asOf.getMonth() > birth.getMonth() ||
    (asOf.getMonth() === birth.getMonth() && asOf.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

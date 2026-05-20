/**
 * Churn Score Calculator for the Shadow Debt Detector.
 *
 * Calculates a deterministic weighted sum of unique contributors and commit count
 * for a file within a configurable analysis period. Contributors are weighted more
 * heavily since they indicate knowledge fragmentation — a key signal of shadow debt.
 *
 * @module churn-calculator
 * @requirements 2.1, 2.5
 */

/**
 * Weight applied to the number of unique contributors.
 * Contributors are weighted more heavily because a high number of unique contributors
 * indicates knowledge fragmentation and increased coordination overhead.
 */
export const CONTRIBUTOR_WEIGHT = 3;

/**
 * Weight applied to the number of commits.
 * Commits indicate change frequency but are weighted less than contributors
 * since a single contributor making many commits is less risky than many contributors.
 */
export const COMMIT_WEIGHT = 1;

/**
 * Minimum number of months of git history required to perform churn analysis.
 */
export const MINIMUM_HISTORY_MONTHS = 3;

/**
 * Calculates the Churn Score for a file as a deterministic weighted sum
 * of unique contributors and commit count.
 *
 * Formula: score = (uniqueContributors * CONTRIBUTOR_WEIGHT) + (commitCount * COMMIT_WEIGHT)
 *
 * @param uniqueContributors - Number of unique contributors who modified the file within the analysis period
 * @param commitCount - Number of commits that modified the file within the analysis period
 * @returns The calculated churn score (always >= 0)
 */
export function calculateChurnScore(uniqueContributors: number, commitCount: number): number {
  return (uniqueContributors * CONTRIBUTOR_WEIGHT) + (commitCount * COMMIT_WEIGHT);
}

/**
 * Validates whether the available git history meets the minimum requirement
 * for churn score analysis.
 *
 * The Shadow Debt Detector requires at least 3 months of git history to produce
 * meaningful churn classifications. If the history is insufficient, the detector
 * should inform the user and not generate classifications.
 *
 * @param availableMonths - Number of months of git history available in the repository
 * @returns An object indicating whether the history is sufficient, with an error message if not
 */
export function validateHistoryPeriod(availableMonths: number): { valid: boolean; message?: string } {
  if (availableMonths < MINIMUM_HISTORY_MONTHS) {
    return {
      valid: false,
      message: `El análisis requiere un historial mínimo de ${MINIMUM_HISTORY_MONTHS} meses. El repositorio solo tiene ${availableMonths} meses de historial disponible.`,
    };
  }

  return { valid: true };
}

/**
 * Default configuration module for Archeology Power.
 *
 * Provides default values and validation for all configurable parameters.
 */

/**
 * Configuration interface for Archeology Power.
 * Defined locally until src/types/index.ts is available.
 */
export interface ArcheologyConfig {
  contributorThreshold: number;
  docStalenessMonths: number;
  analysisPeriodMonths: number;
  coOccurrenceThreshold: number;
  couplingAnalysisPeriodMonths: number;
  fileAgeThresholdYears: number;
  deletionLineThreshold: number;
  externalLlm?: {
    enabled: boolean;
    endpoint: string;
    apiKey: string;
  };
}

/**
 * Validation error for a single configuration field.
 */
export interface ConfigValidationError {
  field: string;
  message: string;
  providedValue: unknown;
  minimumValue: number;
}

/**
 * Result of configuration validation.
 */
export type ConfigValidationResult =
  | { valid: true }
  | { valid: false; errors: ConfigValidationError[] };

/**
 * Default configuration values for Archeology Power.
 */
export const DEFAULT_CONFIG: ArcheologyConfig = {
  contributorThreshold: 20,
  docStalenessMonths: 6,
  analysisPeriodMonths: 12,
  coOccurrenceThreshold: 0.70,
  couplingAnalysisPeriodMonths: 12,
  fileAgeThresholdYears: 2,
  deletionLineThreshold: 10,
};

/**
 * Minimum allowed values for configurable parameters.
 */
const MIN_VALUES: Partial<Record<keyof ArcheologyConfig, number>> = {
  contributorThreshold: 1,
  docStalenessMonths: 1,
  analysisPeriodMonths: 3,
  coOccurrenceThreshold: 0.50,
  couplingAnalysisPeriodMonths: 3,
};

/**
 * Validates a partial configuration object, checking that all provided
 * numeric fields meet their minimum value constraints.
 *
 * @param config - Partial configuration to validate
 * @returns Validation result indicating success or failure with specific errors
 */
export function validateConfig(config: Partial<ArcheologyConfig>): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];

  for (const [field, minValue] of Object.entries(MIN_VALUES)) {
    const key = field as keyof ArcheologyConfig;
    const value = config[key];

    if (value !== undefined && typeof value === 'number') {
      if (value < minValue) {
        errors.push({
          field,
          message: `${field} must be at least ${minValue}, received ${value}`,
          providedValue: value,
          minimumValue: minValue,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

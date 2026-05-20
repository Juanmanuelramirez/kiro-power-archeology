import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  validateConfig,
  type ArcheologyConfig,
  type ConfigValidationResult,
} from './defaults.js';

describe('DEFAULT_CONFIG', () => {
  it('has correct default values', () => {
    expect(DEFAULT_CONFIG.contributorThreshold).toBe(20);
    expect(DEFAULT_CONFIG.docStalenessMonths).toBe(6);
    expect(DEFAULT_CONFIG.analysisPeriodMonths).toBe(12);
    expect(DEFAULT_CONFIG.coOccurrenceThreshold).toBe(0.70);
    expect(DEFAULT_CONFIG.couplingAnalysisPeriodMonths).toBe(12);
    expect(DEFAULT_CONFIG.fileAgeThresholdYears).toBe(2);
    expect(DEFAULT_CONFIG.deletionLineThreshold).toBe(10);
  });

  it('does not include externalLlm by default', () => {
    expect(DEFAULT_CONFIG.externalLlm).toBeUndefined();
  });
});

describe('validateConfig', () => {
  it('accepts an empty config (no fields to validate)', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
  });

  it('accepts valid values at minimums', () => {
    const result = validateConfig({
      contributorThreshold: 1,
      docStalenessMonths: 1,
      analysisPeriodMonths: 3,
      coOccurrenceThreshold: 0.50,
      couplingAnalysisPeriodMonths: 3,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid values above minimums', () => {
    const result = validateConfig({
      contributorThreshold: 50,
      docStalenessMonths: 12,
      analysisPeriodMonths: 24,
      coOccurrenceThreshold: 0.90,
      couplingAnalysisPeriodMonths: 18,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects contributorThreshold below minimum', () => {
    const result = validateConfig({ contributorThreshold: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('contributorThreshold');
      expect(result.errors[0].minimumValue).toBe(1);
      expect(result.errors[0].providedValue).toBe(0);
    }
  });

  it('rejects docStalenessMonths below minimum', () => {
    const result = validateConfig({ docStalenessMonths: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('docStalenessMonths');
      expect(result.errors[0].minimumValue).toBe(1);
    }
  });

  it('rejects analysisPeriodMonths below minimum', () => {
    const result = validateConfig({ analysisPeriodMonths: 2 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('analysisPeriodMonths');
      expect(result.errors[0].minimumValue).toBe(3);
    }
  });

  it('rejects coOccurrenceThreshold below minimum', () => {
    const result = validateConfig({ coOccurrenceThreshold: 0.49 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('coOccurrenceThreshold');
      expect(result.errors[0].minimumValue).toBe(0.50);
    }
  });

  it('rejects couplingAnalysisPeriodMonths below minimum', () => {
    const result = validateConfig({ couplingAnalysisPeriodMonths: 2 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('couplingAnalysisPeriodMonths');
      expect(result.errors[0].minimumValue).toBe(3);
    }
  });

  it('collects multiple errors when multiple fields are invalid', () => {
    const result = validateConfig({
      contributorThreshold: 0,
      docStalenessMonths: 0,
      analysisPeriodMonths: 1,
      coOccurrenceThreshold: 0.10,
      couplingAnalysisPeriodMonths: 1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(5);
    }
  });

  it('does not validate fields without minimum constraints', () => {
    const result = validateConfig({
      fileAgeThresholdYears: 0,
      deletionLineThreshold: 0,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects negative values', () => {
    const result = validateConfig({ contributorThreshold: -5 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe('contributorThreshold');
      expect(result.errors[0].providedValue).toBe(-5);
    }
  });

  it('provides clear error messages indicating minimum value', () => {
    const result = validateConfig({ analysisPeriodMonths: 2 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].message).toContain('at least 3');
      expect(result.errors[0].message).toContain('received 2');
    }
  });
});

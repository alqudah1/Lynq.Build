import { DomainRuleViolationError } from "@/lib/authz/errors";

export class StaleAnalyticsUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_analytics_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleAnalyticsUpdateError";
  }
}

export class UnknownMetricError extends DomainRuleViolationError {
  readonly reason = "unknown_metric";
  constructor(metricKey: string) {
    super(`"${metricKey}" is not a registered metric.`);
    this.name = "UnknownMetricError";
  }
}

export class UnsupportedDimensionError extends DomainRuleViolationError {
  readonly reason = "unsupported_dimension";
  constructor(metricKey: string, dimensionKey: string) {
    super(`Metric "${metricKey}" does not support grouping by "${dimensionKey}".`);
    this.name = "UnsupportedDimensionError";
  }
}

export class UnsupportedTimeGrainError extends DomainRuleViolationError {
  readonly reason = "unsupported_time_grain";
  constructor(metricKey: string, grain: string) {
    super(`Metric "${metricKey}" does not support the "${grain}" time grain.`);
    this.name = "UnsupportedTimeGrainError";
  }
}

export class QueryTooComplexError extends DomainRuleViolationError {
  readonly reason = "query_too_complex";
  constructor(message: string) {
    super(message);
    this.name = "QueryTooComplexError";
  }
}

export class AnalyticsRoleAlreadyGrantedError extends DomainRuleViolationError {
  readonly reason = "analytics_role_already_granted";
  constructor() {
    super("This user already has an active Analytics role.");
    this.name = "AnalyticsRoleAlreadyGrantedError";
  }
}

export class DrilldownNotSupportedError extends DomainRuleViolationError {
  readonly reason = "drilldown_not_supported";
  constructor(metricKey: string) {
    super(`Metric "${metricKey}" has no drill-down defined.`);
    this.name = "DrilldownNotSupportedError";
  }
}

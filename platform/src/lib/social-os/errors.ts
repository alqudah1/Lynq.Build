import { DomainRuleViolationError } from "@/lib/authz/errors";

/**
 * Module 19 — Social Command Center domain errors. Every one extends
 * `DomainRuleViolationError` so `handleRouteError` maps it to a 409 (or the
 * explicit `httpStatus`) with a stable `reason` code; nothing here ever
 * carries a token, a provider payload or a stack trace in its message.
 */

export class StaleSocialUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleSocialUpdateError";
  }
}

export class InvalidSocialTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_social_transition";
  constructor(entity: string, from: string, to: string) {
    super(`Cannot move ${entity} from "${from}" to "${to}"`);
    this.name = "InvalidSocialTransitionError";
  }
}

export class SocialBrandKeyTakenError extends DomainRuleViolationError {
  readonly reason = "social_brand_key_taken";
  constructor(key: string) {
    super(`A brand with key "${key}" already exists in this organization`);
    this.name = "SocialBrandKeyTakenError";
  }
}

export class SocialBrandArchivedError extends DomainRuleViolationError {
  readonly reason = "social_brand_archived";
  constructor() {
    super("This brand is archived");
    this.name = "SocialBrandArchivedError";
  }
}

export class SocialVariantNotPublishableError extends DomainRuleViolationError {
  readonly reason = "social_variant_not_publishable";
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(`This post cannot be published yet: ${blockers.join("; ")}`);
    this.name = "SocialVariantNotPublishableError";
    this.blockers = blockers;
  }
}

export class SocialAccountNotConnectedError extends DomainRuleViolationError {
  readonly reason = "social_account_not_connected";
  constructor(status: string) {
    super(`The target account is not connected (status: ${status})`);
    this.name = "SocialAccountNotConnectedError";
  }
}

export class SocialAccountBrandMismatchError extends DomainRuleViolationError {
  readonly reason = "social_account_brand_mismatch";
  constructor() {
    super("The selected account belongs to a different brand than this content");
    this.name = "SocialAccountBrandMismatchError";
  }
}

export class SocialPlatformMismatchError extends DomainRuleViolationError {
  readonly reason = "social_platform_mismatch";
  constructor() {
    super("The selected account is on a different platform than this variant");
    this.name = "SocialPlatformMismatchError";
  }
}

export class SocialInvalidScheduleError extends DomainRuleViolationError {
  readonly reason = "social_invalid_schedule";
  constructor(detail: string) {
    super(`Invalid schedule: ${detail}`);
    this.name = "SocialInvalidScheduleError";
  }
}

export class SocialDuplicatePublishError extends DomainRuleViolationError {
  readonly reason = "social_duplicate_publish";
  constructor() {
    super("A publish job for this post is already queued or running");
    this.name = "SocialDuplicatePublishError";
  }
}

export class SocialApprovalRequiredError extends DomainRuleViolationError {
  readonly reason = "social_approval_required";
  constructor(what = "this action") {
    super(`A human approval is required before ${what}`);
    this.name = "SocialApprovalRequiredError";
  }
}

export class SocialProviderNotConfiguredError extends DomainRuleViolationError {
  readonly reason = "social_provider_not_configured";
  readonly httpStatus = 503;
  readonly provider: string;
  readonly missing: string[];
  constructor(provider: string, missing: string[]) {
    super(`${provider} is not configured on this server (missing: ${missing.join(", ")})`);
    this.name = "SocialProviderNotConfiguredError";
    this.provider = provider;
    this.missing = missing;
  }
}

export class SocialProviderNotSupportedError extends DomainRuleViolationError {
  readonly reason = "social_provider_not_supported";
  constructor(platform: string, capability: string) {
    super(`${platform} does not support ${capability} through an official API in this build`);
    this.name = "SocialProviderNotSupportedError";
  }
}

/** The provider rejected our call. `retryable` drives the runtime queue's failure class. */
export class SocialProviderError extends DomainRuleViolationError {
  readonly reason = "social_provider_error";
  readonly httpStatus = 502;
  readonly provider: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly authorizationLost: boolean;
  constructor(provider: string, code: string, message: string, options: { retryable?: boolean; authorizationLost?: boolean } = {}) {
    super(`${provider}: ${message}`);
    this.name = "SocialProviderError";
    this.provider = provider;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.authorizationLost = options.authorizationLost ?? false;
  }
}

export class SocialTokenExpiredError extends SocialProviderError {
  constructor(provider: string) {
    super(provider, "token_expired", "the stored authorization has expired — reconnect the account", { retryable: false, authorizationLost: true });
    this.name = "SocialTokenExpiredError";
  }
}

export class SocialCredentialMissingError extends DomainRuleViolationError {
  readonly reason = "social_credential_missing";
  constructor() {
    super("No active credential is stored for this connection — reconnect the account");
    this.name = "SocialCredentialMissingError";
  }
}

export class SocialOAuthStateError extends DomainRuleViolationError {
  readonly reason = "social_oauth_state_invalid";
  readonly httpStatus = 400;
  constructor(detail = "the sign-in attempt could not be verified") {
    super(`Connection failed: ${detail}`);
    this.name = "SocialOAuthStateError";
  }
}

export class SocialGenerationFailedError extends DomainRuleViolationError {
  readonly reason = "social_generation_failed";
  readonly httpStatus = 502;
  readonly provider: string;
  readonly retryable: boolean;
  constructor(provider: string, message: string, retryable = false) {
    super(`${provider}: ${message}`);
    this.name = "SocialGenerationFailedError";
    this.provider = provider;
    this.retryable = retryable;
  }
}

export class SocialGenerationLimitError extends DomainRuleViolationError {
  readonly reason = "social_generation_limit";
  readonly httpStatus = 429;
  constructor(detail: string) {
    super(`Generation limit reached: ${detail}`);
    this.name = "SocialGenerationLimitError";
  }
}

export class SocialAssetNotUsableError extends DomainRuleViolationError {
  readonly reason = "social_asset_not_usable";
  constructor(detail: string) {
    super(`Asset cannot be used: ${detail}`);
    this.name = "SocialAssetNotUsableError";
  }
}

export class SocialAdChangeNotExecutableError extends DomainRuleViolationError {
  readonly reason = "social_ad_change_not_executable";
  constructor(detail: string) {
    super(`This advertising change cannot be executed: ${detail}`);
    this.name = "SocialAdChangeNotExecutableError";
  }
}

export class SocialAutomationRuleExistsError extends DomainRuleViolationError {
  readonly reason = "social_automation_rule_exists";
  constructor() {
    super("An automation rule of this kind already exists for this scope");
    this.name = "SocialAutomationRuleExistsError";
  }
}

export class SocialEngagementNotRepliableError extends DomainRuleViolationError {
  readonly reason = "social_engagement_not_repliable";
  constructor(detail: string) {
    super(`Cannot reply: ${detail}`);
    this.name = "SocialEngagementNotRepliableError";
  }
}

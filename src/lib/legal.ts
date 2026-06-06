export const LEGAL_EFFECTIVE_DATE_LABEL = '2026年6月6日';
export const CURRENT_TERMS_VERSION = '2026-06-06';
export const CURRENT_PRIVACY_POLICY_VERSION = '2026-06-06';

export function hasAcceptedCurrentLegalDocs(user?: {
  hasAgreedToTerms?: boolean;
  termsVersion?: string;
  privacyPolicyVersion?: string;
} | null) {
  return Boolean(
    user?.hasAgreedToTerms &&
    user.termsVersion === CURRENT_TERMS_VERSION &&
    user.privacyPolicyVersion === CURRENT_PRIVACY_POLICY_VERSION
  );
}

import {
  CURRENT_PRIVACY_POLICY_VERSION,
  CURRENT_TERMS_VERSION,
  hasAcceptedCurrentLegalDocs,
} from '@/lib/legal';

describe('legal consent versions', () => {
  it('accepts the current terms and privacy policy versions', () => {
    expect(hasAcceptedCurrentLegalDocs({
      hasAgreedToTerms: true,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION,
    })).toBe(true);
  });

  it('requires renewed consent for the previous privacy policy', () => {
    expect(hasAcceptedCurrentLegalDocs({
      hasAgreedToTerms: true,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyPolicyVersion: '2026-06-06',
    })).toBe(false);
  });
});

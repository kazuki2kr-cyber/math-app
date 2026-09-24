# Drill Integrity Controls

This document describes the low-cost controls around `processDrillResult` and the admin response workflow.

## Enforced server-side policy

- Maximum accepted drill submissions per user and Tokyo calendar day: 150
- Maximum XP earned from drills per user and day: 5,000
- Submissions averaging less than 0.3 seconds per question are rejected when at least 10 answers are present.
- A submission less than 5 seconds after the previous accepted submission is rejected.
- The third consecutive submission less than 15 seconds apart is rejected.
- Repeated-unit XP multiplier: attempts 1-3 = 100%, 4-5 = 70%, 6-10 = 30%, 11-20 = 10%, 21+ = 0%.
- An administrator can stop or resume XP earning for one user without preventing legitimate practice.

The guard counters are stored inside the existing `users/{uid}` document and updated in the same transaction as the score. A normal accepted submission therefore adds no Firestore read or write solely for rate limiting.

## Detection storage and cost

Suspicious or rejected traffic is sampled at most once per user per 15-minute window. Each sample updates one `integrity_events` document and one `integrity_user_summaries` document. Repeated rejected calls inside the same window do not create more detection documents.

The event document has `expireAt` and is retained for 30 days. The summary remains until reviewed or administratively removed. The admin integrity screen must describe `flaggedAttemptCount` as sampled detections rather than a complete count of suspicious submissions.

## Per-user reset

`resetUserLearningData` performs the trusted reset in Cloud Functions. It:

- resets XP, level, score, unit state, icon state, and current guard counters;
- increments `learningGeneration`;
- removes the user from the overall leaderboard in the same transaction;
- emits one `USER_DATA_RESET` analytics event;
- deletes the small current-state subcollections `wrong_answers` and `writtenAttemptLimits`;
- retains attempt and integrity history for audit and TTL cleanup.

BigQuery fact builders ignore that user's submissions at or before the latest `USER_DATA_RESET`. This gives an immediate logical reset without paying for a browser-driven mass deletion.

## App Check rollout

The web client initializes Firebase App Check with reCAPTCHA Enterprise when `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` is configured. `processDrillResult` enforces valid App Check tokens when the Functions runtime variable `ENFORCE_APP_CHECK` is exactly `true`.

Roll out in this order:

1. Register the production web app and approved development origins in Firebase App Check.
2. Configure `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` in each deployed web environment and deploy the web app.
3. Confirm valid-request metrics and test a real drill submission from each supported environment.
4. Set `ENFORCE_APP_CHECK=true` for Functions and deploy `processDrillResult`.
5. Monitor callable rejection and integrity-summary volumes after enforcement.

Keep enforcement disabled until the site key is deployed and verified; otherwise all exercise result submissions will fail. App Check raises the cost of scripted API access but does not replace the transaction guard because automation can still run inside a genuine browser.

## Remaining hardening phase

The current unit documents still expose multiple-choice answer keys to authorized clients because Firestore rules cannot hide individual fields. The transaction guard, daily caps, and App Check contain the observed XP abuse, but they do not make answer keys secret.

Moving answer keys to a server-only collection requires a staged content migration and a server-backed question delivery contract. Treat that as a separate deployment with compatibility checks for existing units and clients; do not remove the current fields before the new delivery path is live.

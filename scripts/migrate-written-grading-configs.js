/**
 * 既存の記述式イベント（drillType === 'written'）について、
 * questions/{qId} から採点用秘密情報（modelAnswer / model_answer / gradingRubric /
 * grading_rubric / explanation / iconReward）を admin-only の grading_configs/{qId} へ分離移行するスクリプト。
 *
 * デフォルトは DRY-RUN（書き込みなし）。本番適用時は --apply を付けて実行する。
 *   node scripts/migrate-written-grading-configs.js
 *   node scripts/migrate-written-grading-configs.js --apply
 */

const path = require('node:path');
const dotenv = require('dotenv');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

dotenv.config({ path: path.join(process.cwd(), '.env.local'), quiet: true });

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
const isDryRun = !process.argv.includes('--apply');

function pickNonEmptyString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return '';
}

function pickNonEmptyRubric(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return [];
}

function hasSecretFields(questionData, unitData) {
  return (
    questionData.modelAnswer !== undefined ||
    questionData.model_answer !== undefined ||
    questionData.gradingRubric !== undefined ||
    questionData.grading_rubric !== undefined ||
    questionData.explanation !== undefined ||
    questionData.iconReward !== undefined ||
    questionData.answer_index !== undefined ||
    unitData.gradingRubric !== undefined
  );
}

function buildMigratedPayload(unitData, questionData, existingConfig) {
  return {
    modelAnswer: pickNonEmptyString(
      existingConfig.modelAnswer,
      questionData.modelAnswer,
      questionData.model_answer,
      questionData.explanation,
      existingConfig.explanation
    ),
    gradingRubric: pickNonEmptyRubric(
      existingConfig.gradingRubric,
      questionData.gradingRubric,
      questionData.grading_rubric,
      unitData.gradingRubric
    ),
    explanation: pickNonEmptyString(existingConfig.explanation, questionData.explanation),
    iconReward: existingConfig.iconReward ?? questionData.iconReward ?? null,
  };
}

function isMissingAdcError(err) {
  const message = err instanceof Error ? err.message : String(err || '');
  return (
    message.includes('Could not load the default credentials') ||
    message.includes('Unable to detect a Project Id')
  );
}

async function runMigrationWithAdapter(adapter) {
  const writtenUnits = await adapter.listWrittenUnits();
  console.log(`対象となる記述式単元数: ${writtenUnits.length}`);

  let migratedQuestions = 0;
  let scrubbedUnits = 0;

  for (const unit of writtenUnits) {
    const unitData = unit.data || {};
    const questions = await adapter.listUnitQuestions(unit);

    for (const question of questions) {
      const q = question.data || {};
      if (!hasSecretFields(q, unitData)) continue;

      const existingConfig = await adapter.getExistingGradingConfig(unit, question.id);
      const payload = buildMigratedPayload(unitData, q, existingConfig);

      console.log(`  [${unit.id}/questions/${question.id}] -> grading_configs/${question.id}`);

      if (!isDryRun) {
        await adapter.applyQuestionMigration(unit, question, payload);
      }

      migratedQuestions += 1;
    }

    if (unitData.gradingRubric !== undefined) {
      console.log(`  [${unit.id}] unit.gradingRubric を削除`);
      if (!isDryRun) {
        await adapter.scrubUnitRubric(unit);
      }
      scrubbedUnits += 1;
    }
  }

  console.log(`\n完了: 移行問題数=${migratedQuestions}, unit.gradingRubric削除=${scrubbedUnits}`);
  if (isDryRun) {
    console.log('※ DRY-RUN のため Firestore への書き込みは行っていません。適用時は --apply を指定してください。');
  }
}

async function runViaAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();

  await runMigrationWithAdapter({
    async listWrittenUnits() {
      const unitsSnap = await db.collection('units').where('drillType', '==', 'written').get();
      return unitsSnap.docs.map((unitDoc) => ({
        id: unitDoc.id,
        ref: unitDoc.ref,
        data: unitDoc.data() || {},
      }));
    },
    async listUnitQuestions(unit) {
      const questionsSnap = await unit.ref.collection('questions').get();
      return questionsSnap.docs.map((questionDoc) => ({
        id: questionDoc.id,
        ref: questionDoc.ref,
        data: questionDoc.data() || {},
      }));
    },
    async getExistingGradingConfig(unit, questionId) {
      const snap = await unit.ref.collection('grading_configs').doc(questionId).get();
      return snap.exists ? snap.data() || {} : {};
    },
    async applyQuestionMigration(unit, question, payload) {
      const batch = db.batch();
      const gradingConfigRef = unit.ref.collection('grading_configs').doc(question.id);
      batch.set(
        gradingConfigRef,
        {
          ...payload,
          migratedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batch.update(question.ref, {
        modelAnswer: FieldValue.delete(),
        model_answer: FieldValue.delete(),
        gradingRubric: FieldValue.delete(),
        grading_rubric: FieldValue.delete(),
        explanation: FieldValue.delete(),
        iconReward: FieldValue.delete(),
        answer_index: FieldValue.delete(),
      });
      await batch.commit();
    },
    async scrubUnitRubric(unit) {
      await unit.ref.update({
        gradingRubric: FieldValue.delete(),
      });
    },
  });
}

async function runViaClientSdk() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const adminEmail = process.env.TEST_USER_EMAIL;
  const adminPassword = process.env.TEST_USER_PASSWORD;

  if (!apiKey || !adminEmail || !adminPassword) {
    throw new Error('ADC未設定時のフォールバックには NEXT_PUBLIC_FIREBASE_API_KEY / TEST_USER_EMAIL / TEST_USER_PASSWORD が必要です。');
  }

  const [{ deleteApp, initializeApp }, { getAuth, signInWithEmailAndPassword, signOut }, firestore] =
    await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);

  const {
    collection,
    deleteField,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch,
  } = firestore;

  const clientApp = initializeApp({ apiKey, projectId }, `migrate-written-${Date.now()}`);
  const auth = getAuth(clientApp);
  const clientDb = getFirestore(clientApp);

  try {
    const cred = await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
    const tokenResult = await cred.user.getIdTokenResult(true);
    if (tokenResult.claims?.admin !== true) {
      throw new Error('サインインしたアカウントに admin カスタムクレームがありません。');
    }

    await runMigrationWithAdapter({
      async listWrittenUnits() {
        const unitsSnap = await getDocs(
          query(collection(clientDb, 'units'), where('drillType', '==', 'written'))
        );
        return unitsSnap.docs.map((unitDoc) => ({
          id: unitDoc.id,
          data: unitDoc.data() || {},
        }));
      },
      async listUnitQuestions(unit) {
        const questionsSnap = await getDocs(collection(clientDb, 'units', unit.id, 'questions'));
        return questionsSnap.docs.map((questionDoc) => ({
          id: questionDoc.id,
          data: questionDoc.data() || {},
        }));
      },
      async getExistingGradingConfig(unit, questionId) {
        const snap = await getDoc(doc(clientDb, 'units', unit.id, 'grading_configs', questionId));
        return snap.exists() ? snap.data() || {} : {};
      },
      async applyQuestionMigration(unit, question, payload) {
        const batch = writeBatch(clientDb);
        const gradingConfigRef = doc(clientDb, 'units', unit.id, 'grading_configs', question.id);
        const questionRef = doc(clientDb, 'units', unit.id, 'questions', question.id);
        batch.set(
          gradingConfigRef,
          {
            ...payload,
            migratedAt: serverTimestamp(),
          },
          { merge: true }
        );
        batch.update(questionRef, {
          modelAnswer: deleteField(),
          model_answer: deleteField(),
          gradingRubric: deleteField(),
          grading_rubric: deleteField(),
          explanation: deleteField(),
          iconReward: deleteField(),
          answer_index: deleteField(),
        });
        await batch.commit();
      },
      async scrubUnitRubric(unit) {
        await updateDoc(doc(clientDb, 'units', unit.id), {
          gradingRubric: deleteField(),
        });
      },
    });
  } finally {
    await signOut(auth).catch(() => undefined);
    await deleteApp(clientApp).catch(() => undefined);
  }
}

async function migrateWrittenGradingConfigs() {
  console.log(`=== 記述式採点設定の分離マイグレーション (${isDryRun ? 'DRY-RUN' : 'APPLY'}) ===`);

  try {
    await runViaAdmin();
  } catch (err) {
    if (!isMissingAdcError(err)) {
      throw err;
    }
    console.log('ADC未設定のため、.env.local の管理者アカウント認証で続行します。');
    await runViaClientSdk();
  }
}

migrateWrittenGradingConfigs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('マイグレーションエラー:', err);
    process.exit(1);
  });

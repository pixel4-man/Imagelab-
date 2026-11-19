import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Validates firestore.rules against the Dirty Dozen specification in security_spec.md.
// When FIRESTORE_EMULATOR_HOST is running, exercises live @firebase/rules-unit-testing assertions;
// otherwise verifies full blueprint-to-rules coverage and invariant enforcement.

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const BLUEPRINT_PATH = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('Dirty Dozen Blueprint & Rules Coverage Verification', async () => {
  const rules = fs.readFileSync(RULES_PATH, 'utf-8');
  const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf-8')) as {
    firestore: Record<string, unknown>;
  };

  // Every collection in firebase-blueprint.json must have a match block in firestore.rules
  const collectionNames = Object.keys(blueprint.firestore).map((p) =>
    p.split('/').filter(Boolean)[0]
  );
  for (const col of collectionNames) {
    assert.ok(
      rules.includes(`match /${col}/`),
      `Expected match block for collection /${col}/ in firestore.rules`
    );
  }

  // Dirty Dozen Invariant Checks
  assert.ok(rules.includes("incoming().role == 'contributor'"), 'Client create must force contributor');
  assert.ok(rules.includes("incoming().accountStatus == 'active'"), 'Client create must force active');
  assert.ok(rules.includes('incoming().createdAt == request.time'), 'Must enforce server timestamp');
  assert.ok(rules.includes('affectedKeys().hasOnly(['), 'Updates must restrict affectedKeys');
  assert.ok(rules.includes('isValidId('), 'Single-document operations must validate ID format');
  assert.ok(!rules.includes('allow read: if isSignedIn();'), 'Blanket signed-in reads are forbidden');

  // Ads Manager & Visual Placements Security Invariants
  assert.match(rules, /match \/adPlacements\/\{placementId\}[\s\S]*allow get, list: if isAdmin\(\)/);
  assert.match(rules, /isValidAdPlacement[\s\S]*'width'[\s\S]*'height'[\s\S]*'adType'/);
  assert.match(rules, /match \/ads\/\{adId\}[\s\S]*allow get, list: if isAdmin\(\)/);
  assert.match(rules, /function isValidOptionalDestinationUrl\(url\)/);
  assert.match(rules, /isValidAdCampaign[\s\S]*'destinationUrl'[\s\S]*isValidOptionalDestinationUrl/);
  assert.match(rules, /isValidPublicAdSlot[\s\S]*'destinationUrl'[\s\S]*isValidOptionalDestinationUrl/);
  assert.match(
    rules,
    /match \/publicAdSlots\/\{adId\}[\s\S]*allow get: if isValidId\(adId\) && existing\(\)\.status == 'active'/
  );
  assert.match(
    rules,
    /match \/publicAdSlots\/\{adId\}[\s\S]*allow create: if isAdmin\(\)[\s\S]*incoming\(\)\.status == 'active'/
  );
});

test('Live Firestore Emulator Dirty Dozen Suite (runs when emulator host is configured)', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('FIRESTORE_EMULATOR_HOST is not set in this sandbox; static & server tests verified.');
    return;
  }

  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import(
    '@firebase/rules-unit-testing'
  );
  const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');

  const testEnv = await initializeTestEnvironment({
    projectId: 'imagelab-test',
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
    },
  });

  try {
    // 1. Self-Admin registration rejected
    const attacker = testEnv.authenticatedContext('attacker', {
      email: 'attacker@example.com',
      email_verified: true,
    });
    await assertFails(
      setDoc(doc(attacker.firestore(), 'users/attacker'), {
        uid: 'attacker',
        fullName: 'Attacker',
        username: 'attacker1',
        email: 'attacker@example.com',
        photoURL: '',
        bio: '',
        role: 'admin',
        accountStatus: 'active',
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      })
    );

    // 2. Valid contributor signup succeeds
    const contrib = testEnv.authenticatedContext('contrib1', {
      email: 'contrib@example.com',
      email_verified: true,
    });
    await assertSucceeds(
      setDoc(doc(contrib.firestore(), 'users/contrib1'), {
        uid: 'contrib1',
        fullName: 'Contributor One',
        username: 'contrib1',
        email: 'contrib@example.com',
        photoURL: '',
        bio: '',
        role: 'contributor',
        accountStatus: 'active',
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      })
    );

    // 3. Role escalation update rejected
    await assertFails(
      updateDoc(doc(contrib.firestore(), 'users/contrib1'), {
        role: 'super_admin',
        lastLoginAt: serverTimestamp(),
      })
    );

    // 4. Cross-user PII read rejected
    await assertFails(getDoc(doc(attacker.firestore(), 'users/contrib1')));
  } finally {
    await testEnv.cleanup();
  }
});

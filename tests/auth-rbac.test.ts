import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  canAccessDashboard,
  DEFAULT_SUPER_ADMIN_EMAIL,
  getDashboardPathForRole,
  isEligibleForSuperAdminBootstrap,
  validateAccountStatusChange,
  validateRoleTransition,
} from '../src/server/rbac.ts';
import {
  normalizeUsername,
  buildSafeProfileFields,
  ProfileEnsureCoordinator,
} from '../src/lib/profileSync.ts';
import {
  detectAdProvider,
  findDuplicatePlacement,
  formatReadableError,
  hasOwnInteractiveOrScriptElements,
  normalizeCreativeMarkup,
  normalizePageRoute,
  normalizeSlotIdentifier,
  validateAdPayload,
  validatePlacementPayload,
  validateSafeHttpUrl,
} from '../src/types/ads.ts';
import { buildSandboxedAdSrcDoc } from '../src/lib/adFrameHtml.ts';
import {
  callJsonApiWithFallback,
  isJsonContentType,
} from '../src/lib/adsApiClient.ts';

test('1. Super Admin bootstrap requires exact verified email adilwss67@gmail.com', () => {
  assert.equal(DEFAULT_SUPER_ADMIN_EMAIL, 'adilwss67@gmail.com');
  assert.equal(isEligibleForSuperAdminBootstrap('adilwss67@gmail.com', true), true);
  assert.equal(isEligibleForSuperAdminBootstrap('ADILWSS67@GMAIL.COM', true), true);
  // Spoofed unverified email MUST be rejected
  assert.equal(isEligibleForSuperAdminBootstrap('adilwss67@gmail.com', false), false);
  assert.equal(isEligibleForSuperAdminBootstrap('adilwss67@gmail.com', undefined), false);
  // Non-super-admin emails MUST be rejected
  assert.equal(isEligibleForSuperAdminBootstrap('someone@example.com', true), false);
  assert.equal(isEligibleForSuperAdminBootstrap(null, true), false);
});

test('2. Role-based authentication redirects route to correct dashboards', () => {
  assert.equal(getDashboardPathForRole('contributor'), '/dashboard');
  assert.equal(getDashboardPathForRole('admin'), '/admin');
  assert.equal(getDashboardPathForRole('super_admin'), '/super-admin');
  assert.equal(getDashboardPathForRole(null), '/dashboard');
});

test('3. Protected dashboard access enforces RBAC hierarchy', () => {
  // Unauthenticated
  assert.equal(canAccessDashboard(null, 'contributor'), false);
  assert.equal(canAccessDashboard(null, 'admin'), false);
  assert.equal(canAccessDashboard(null, 'super_admin'), false);

  // Contributor
  assert.equal(canAccessDashboard('contributor', 'contributor'), true);
  assert.equal(canAccessDashboard('contributor', 'admin'), false);
  assert.equal(canAccessDashboard('contributor', 'super_admin'), false);

  // Admin
  assert.equal(canAccessDashboard('admin', 'contributor'), true);
  assert.equal(canAccessDashboard('admin', 'admin'), true);
  assert.equal(canAccessDashboard('admin', 'super_admin'), false);

  // Super Admin
  assert.equal(canAccessDashboard('super_admin', 'contributor'), true);
  assert.equal(canAccessDashboard('super_admin', 'admin'), true);
  assert.equal(canAccessDashboard('super_admin', 'super_admin'), true);
});

test('4. Role modification guards prevent privilege escalation and protect Super Admin', () => {
  // Contributor cannot modify any role
  assert.equal(
    validateRoleTransition({
      actorRole: 'contributor',
      actorUid: 'u1',
      targetUid: 'u2',
      targetCurrentRole: 'contributor',
      nextRole: 'admin',
    }).allowed,
    false
  );

  // Admin cannot promote anyone to admin or super_admin
  assert.equal(
    validateRoleTransition({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'u2',
      targetCurrentRole: 'contributor',
      nextRole: 'admin',
    }).allowed,
    false
  );
  assert.equal(
    validateRoleTransition({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'u2',
      targetCurrentRole: 'contributor',
      nextRole: 'super_admin',
    }).allowed,
    false
  );

  // Super Admin cannot assign another super_admin via client/role endpoint or demote self
  assert.equal(
    validateRoleTransition({
      actorRole: 'super_admin',
      actorUid: 'sa1',
      targetUid: 'sa1',
      targetCurrentRole: 'super_admin',
      nextRole: 'contributor',
    }).allowed,
    false
  );
  assert.equal(
    validateRoleTransition({
      actorRole: 'super_admin',
      actorUid: 'sa1',
      targetUid: 'u2',
      targetCurrentRole: 'contributor',
      nextRole: 'super_admin',
    }).allowed,
    false
  );

  // Super Admin CAN promote contributor -> admin and demote admin -> contributor
  assert.equal(
    validateRoleTransition({
      actorRole: 'super_admin',
      actorUid: 'sa1',
      targetUid: 'u2',
      targetCurrentRole: 'contributor',
      nextRole: 'admin',
    }).allowed,
    true
  );
  assert.equal(
    validateRoleTransition({
      actorRole: 'super_admin',
      actorUid: 'sa1',
      targetUid: 'a1',
      targetCurrentRole: 'admin',
      nextRole: 'contributor',
    }).allowed,
    true
  );
});

test('5. Account suspension guards protect Super Admin and Admins from peers', () => {
  assert.equal(
    validateAccountStatusChange({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'sa1',
      targetCurrentRole: 'super_admin',
    }).allowed,
    false
  );
  assert.equal(
    validateAccountStatusChange({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'a2',
      targetCurrentRole: 'admin',
    }).allowed,
    false
  );
  assert.equal(
    validateAccountStatusChange({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'u1',
      targetCurrentRole: 'contributor',
    }).allowed,
    true
  );
  assert.equal(
    validateAccountStatusChange({
      actorRole: 'super_admin',
      actorUid: 'sa1',
      targetUid: 'a1',
      targetCurrentRole: 'admin',
    }).allowed,
    true
  );
});

test('6. Firestore security rules enforce Dirty Dozen invariants statically', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.match(rulesText, /rules_version = '2';/);
  assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(rulesText, /incoming\(\)\.role == 'contributor'/);
  assert.match(rulesText, /incoming\(\)\.role == existing\(\)\.role/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesText, /existing\(\)\.role != 'super_admin'/);
  assert.match(rulesText, /match \/siteSettings\/\{settingId\}[\s\S]*isSuperAdmin\(\)/);
  assert.match(rulesText, /match \/ads\/\{adId\}[\s\S]*allow get, list: if isAdmin\(\)/);
  assert.match(rulesText, /incoming\(\)\.authorUid == existing\(\)\.authorUid/);
  assert.match(rulesText, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
});

test('7. ProfileEnsureCoordinator deduplicates concurrent profile creation per UID', async () => {
  const coordinator = new ProfileEnsureCoordinator<{ uid: string; username: string }>();
  let executions = 0;

  const task = async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { uid: 'EcmAvmaE7NQ5VIO40qHE2v33AHb2', username: 'adilwss67' };
  };

  const [res1, res2, res3] = await Promise.all([
    coordinator.run('EcmAvmaE7NQ5VIO40qHE2v33AHb2', task),
    coordinator.run('EcmAvmaE7NQ5VIO40qHE2v33AHb2', task),
    coordinator.run('EcmAvmaE7NQ5VIO40qHE2v33AHb2', task),
  ]);

  assert.equal(executions, 1);
  assert.deepEqual(res1, res2);
  assert.deepEqual(res2, res3);
});

test('8. buildSafeProfileFields and pending registration metadata guard Firestore rule limits', () => {
  const coordinator = new ProfileEnsureCoordinator<unknown>();
  coordinator.setPendingRegistration('Alice@Example.com', {
    fullName: 'Alice Studio',
    username: 'alice_studio',
  });
  assert.deepEqual(coordinator.getPendingRegistration('alice@example.com'), {
    fullName: 'Alice Studio',
    username: 'alice_studio',
  });
  coordinator.clearPendingRegistration('ALICE@example.com');
  assert.equal(coordinator.getPendingRegistration('alice@example.com'), undefined);

  const shortNameFallback = buildSafeProfileFields({
    email: 'a@x.com',
    displayName: 'X',
    photoURL: null,
  });
  assert.equal(shortNameFallback.fullName, 'ImageLab Creator');
  assert.equal(shortNameFallback.email, 'a@x.com');
  assert.equal(shortNameFallback.photoURL, '');

  const providerFallback = buildSafeProfileFields({
    email: null,
    providerEmail: 'AdilWss67@gmail.com',
    displayName: 'Adil',
    photoURL: 'https://example.com/avatar.png',
  });
  assert.equal(providerFallback.fullName, 'Adil');
  assert.equal(providerFallback.email, 'AdilWss67@gmail.com');
  assert.equal(normalizeUsername('Adil Wss!'), 'adilwss');
});

test('9. Persistence, ProtectedRoute authReady guard, and profile preservation invariants hold', () => {
  const firebaseSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/firebase.ts'),
    'utf-8'
  );
  const authContextSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/context/AuthContext.tsx'),
    'utf-8'
  );
  const protectedRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/ProtectedRoute.tsx'),
    'utf-8'
  );
  const appletConfig = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf-8')
  ) as { projectId?: string };

  assert.equal(appletConfig.projectId, 'imagelab-c612a');
  assert.match(firebaseSource, /browserLocalPersistence/);
  assert.match(firebaseSource, /setPersistence\(/);
  assert.match(firebaseSource, /getApps\(\)\.length\s*>\s*0/);
  assert.match(firebaseSource, /EXPECTED_FIREBASE_PROJECT_ID = 'imagelab-c612a'/);
  assert.match(firebaseSource, /apiKey:\s*appletConfig\.apiKey\s*\|\|\s*''/);
  assert.match(firebaseSource, /authDomain:\s*appletConfig\.authDomain\s*\|\|\s*sanitizedEnvAuthDomain/);
  assert.match(firebaseSource, /VITE_FIREBASE_FIRESTORE_DATABASE_ID/);
  assert.match(firebaseSource, /appletConfig\.firestoreDatabaseId/);
  assert.match(firebaseSource, /getFirestore\(app,\s*targetDatabaseId\)/);

  assert.match(authContextSource, /ensureAuthPersistence\(\)/);
  assert.match(authContextSource, /getRedirectResult\(auth\)/);
  assert.match(authContextSource, /onAuthStateChanged\(auth,/);
  assert.match(authContextSource, /updateDoc\(userDocRef,\s*\{\s*lastLoginAt:\s*serverTimestamp\(\)/);

  assert.match(protectedRouteSource, /if\s*\(!authReady/);
  assert.match(protectedRouteSource, /if\s*\(!firebaseUser\)/);
});

test('10. Visual Ad Placement & Ads Manager payload validation, route/slot normalization, and priority clamping', () => {
  assert.equal(normalizeSlotIdentifier('  Hero Sponsor Slot #1 '), 'hero_sponsor_slot_1');
  assert.equal(normalizePageRoute('/explore/?q=test#top'), '/explore');
  assert.equal(normalizePageRoute('trending'), '/trending');

  const validPlacement = validatePlacementPayload({
    name: '  Homepage Below Hero  ',
    pageRoute: '/?ref=preview',
    slotId: 'Homepage Hero Section!',
    selector: '[data-ad-slot="homepage_hero"]',
    elementInfo: 'Homepage Hero Section (<section>)',
    position: 'after',
    status: 'active',
    priority: 1200,
  });
  assert.equal(validPlacement.valid, true);
  assert.equal(validPlacement.sanitized?.name, 'Homepage Below Hero');
  assert.equal(validPlacement.sanitized?.pageRoute, '/');
  assert.equal(validPlacement.sanitized?.slotId, 'homepage_hero_section');
  assert.equal(validPlacement.sanitized?.priority, 999);

  const missingSelector = validatePlacementPayload({
    name: 'Empty Selector',
    pageRoute: '/',
    slotId: 'hero',
    selector: '',
    elementInfo: 'Section',
    position: 'after',
    status: 'active',
    priority: 10,
  });
  assert.equal(missingSelector.valid, false);

  const validAd = validateAdPayload({
    name: '  Header Leaderboard  ',
    provider: '  Google AdSense  ',
    adType: 'responsive_banner',
    scriptCode: '<div data-ad="leaderboard">Banner</div>',
    placementId: 'placement_hero_123',
    width: '728px',
    height: '90px',
    status: 'active',
    priority: 0,
  });
  assert.equal(validAd.valid, true);
  assert.equal(validAd.sanitized?.name, 'Header Leaderboard');
  assert.equal(validAd.sanitized?.placementId, 'placement_hero_123');
  assert.equal(validAd.sanitized?.priority, 1);

  const missingPlacementId = validateAdPayload({
    name: 'Unbound Ad',
    provider: 'Adsterra',
    adType: 'banner',
    scriptCode: '<div>Ad</div>',
    placementId: '',
    width: 'auto',
    height: 'auto',
    status: 'active',
    priority: 5,
  });
  assert.equal(missingPlacementId.valid, false);

  const invalidDims = validateAdPayload({
    name: 'Bad Width',
    provider: 'PropellerAds',
    adType: 'popunder',
    scriptCode: '<script>window.pop=1;</script>',
    placementId: 'placement_1',
    width: 'javascript:alert(1)',
    height: 'auto',
    status: 'active',
    priority: 10,
  });
  assert.equal(invalidDims.valid, false);
});

test('11. Redesigned Navigation removes Categories, keeps single-line desktop & right drawer, and preserves BackButton', () => {
  const navbarSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/Navbar.tsx'),
    'utf-8'
  );
  // Desktop 1-line public nav items without Categories, search bar, or public Dashboard button
  assert.match(navbarSource, />\s*Homepage\s*</);
  assert.match(navbarSource, />\s*Explore Prompts\s*</);
  assert.match(navbarSource, />\s*Trending\s*</);
  assert.match(navbarSource, />\s*Share Your Creations\s*</);
  assert.doesNotMatch(navbarSource, />\s*Categories\s*</);
  assert.doesNotMatch(navbarSource, /<input[\s\S]*search/i);
  assert.doesNotMatch(navbarSource, />\s*Dashboard\s*</);

  // Mobile right-side single-column slide-in drawer with close button & updated public items
  assert.match(navbarSource, /initial=\{\{\s*x:\s*'100%'\s*\}\}/);
  assert.match(navbarSource, /aria-label="Close navigation menu"/);
  for (const label of [
    'Homepage',
    'Explore Prompts',
    'Trending',
    'Share Your Creations',
    'Saved Prompts',
    'User Profile',
    'About ImageLab',
    'Contact',
  ]) {
    assert.ok(navbarSource.includes(label), `Mobile drawer missing label: ${label}`);
  }
  // Role-gated ADMINISTRATION block
  assert.match(navbarSource, /\{isPrivilegedAdmin && \(/);
  assert.match(navbarSource, /ADMINISTRATION/);

  // CategoriesPage deleted and /categories redirects cleanly to /explore
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'src/pages/CategoriesPage.tsx')), false);
  const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  assert.match(appSource, /path="\/categories"[\s\S]*Navigate to="\/explore"/);

  // BackButton must NOT appear on HomePage, and MUST appear on internal pages
  const homeSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/HomePage.tsx'),
    'utf-8'
  );
  assert.doesNotMatch(homeSource, /BackButton/);

  for (const pageFile of [
    'src/pages/ExplorePage.tsx',
    'src/pages/TrendingPage.tsx',
    'src/pages/PromptDetailsPage.tsx',
    'src/pages/PublishPage.tsx',
    'src/pages/SavedPromptsPage.tsx',
    'src/pages/ProfilePage.tsx',
    'src/pages/AboutPage.tsx',
    'src/pages/ContactPage.tsx',
    'src/pages/LoginPage.tsx',
    'src/pages/SignUpPage.tsx',
    'src/pages/AdminDashboardPage.tsx',
    'src/pages/AdsManagerPage.tsx',
    'src/pages/SuperAdminDashboardPage.tsx',
    'src/pages/DashboardPage.tsx',
    'src/pages/LegalPage.tsx',
  ]) {
    const pageSource = fs.readFileSync(path.resolve(process.cwd(), pageFile), 'utf-8');
    assert.match(pageSource, /<BackButton/, `Expected BackButton in ${pageFile}`);
  }
});

test('12. Visual Placement Selector wires data-ad-slot anchors, touch/dblclick overlay, and sandboxed Ad injection', () => {
  const overlaySource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualPlacementOverlay.tsx'),
    'utf-8'
  );
  assert.match(overlaySource, /PLACEMENT SELECTION MODE — Double tap any area to select it\./);
  assert.match(overlaySource, /addEventListener\('dblclick'/);
  assert.match(overlaySource, /addEventListener\('pointerup'/);
  assert.match(overlaySource, /Select Another Area/);
  assert.match(overlaySource, /Confirm Placement/);
  assert.match(overlaySource, /if \(!selectionMode \|\| !isPrivilegedAdmin\)/);

  const injectorSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualAdInjector.tsx'),
    'utf-8'
  );
  assert.match(injectorSource, /createPortal/);
  assert.match(injectorSource, /anchorMissing/);
  assert.match(injectorSource, /LivePublicAdItem/);

  const adSlotSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/AdSlot.tsx'),
    'utf-8'
  );
  assert.match(adSlotSource, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(adSlotSource, /Preview Test Mode/);
  assert.match(adSlotSource, /\/api\/ads\/active/);

  const adsWorkspaceSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/AdsManagerWorkspace.tsx'),
    'utf-8'
  );
  assert.match(adsWorkspaceSource, /Select Placement on Website/);
  assert.match(adsWorkspaceSource, /anchorMissing/);

  const anchorSources = [
    'src/pages/HomePage.tsx',
    'src/pages/ExplorePage.tsx',
    'src/pages/TrendingPage.tsx',
    'src/pages/PromptDetailsPage.tsx',
    'src/components/Footer.tsx',
  ]
    .map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8'))
    .join('\n');

  for (const expectedSlot of [
    'homepage_hero',
    'homepage_trending',
    'homepage_gallery',
    'homepage_callout',
    'explore_header',
    'explore_gallery',
    'trending_spotlight',
    'trending_grid',
    'prompt_details_image',
    'prompt_details_panel',
    'prompt_details_related',
    'site_footer',
  ]) {
    assert.ok(
      anchorSources.includes(`data-ad-slot="${expectedSlot}"`),
      `Missing data-ad-slot="${expectedSlot}" anchor`
    );
  }
});

test('13. Server endpoints expose active visual placements/ads publicly and enforce adminGuard on CRUD routes', () => {
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.match(serverSource, /app\.get\(\s*'\/api\/ads\/active'/);
  assert.match(serverSource, /app\.get\(\s*'\/api\/admin\/placements',\s*requireAuthToken,\s*adminGuard/);
  assert.match(serverSource, /app\.post\(\s*'\/api\/admin\/placements',\s*requireAuthToken,\s*adminGuard/);
  assert.match(
    serverSource,
    /app\.patch\(\s*'\/api\/admin\/placements\/:placementId',\s*requireAuthToken,\s*adminGuard/
  );
  assert.match(
    serverSource,
    /app\.delete\(\s*'\/api\/admin\/placements\/:placementId',\s*requireAuthToken,\s*adminGuard/
  );
  assert.match(serverSource, /app\.get\(\s*'\/api\/admin\/ads',\s*requireAuthToken,\s*adminGuard/);
  assert.match(serverSource, /app\.post\(\s*'\/api\/admin\/ads',\s*requireAuthToken,\s*adminGuard/);
  assert.match(
    serverSource,
    /app\.patch\(\s*'\/api\/admin\/ads\/:adId',\s*requireAuthToken,\s*adminGuard/
  );
  assert.match(
    serverSource,
    /app\.delete\(\s*'\/api\/admin\/ads\/:adId',\s*requireAuthToken,\s*adminGuard/
  );
  assert.match(serverSource, /app\.post\(\s*'\/api\/admin\/prompts',\s*requireAuthToken,\s*adminGuard/);
  assert.match(
    serverSource,
    /app\.patch\(\s*'\/api\/admin\/prompts\/:promptId',\s*requireAuthToken,\s*adminGuard/
  );
  assert.match(
    serverSource,
    /app\.delete\(\s*'\/api\/admin\/prompts\/:promptId',\s*requireAuthToken,\s*adminGuard/
  );
});

test('14. Simplified Prompt Publishing, Prompt Cards, Prompt Details, and Admin Prompt Management exclude Categories & Description clutter', () => {
  const publishSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PublishPage.tsx'),
    'utf-8'
  );
  assert.match(publishSource, /1\. Upload Image/);
  assert.match(publishSource, /2\. Image Title/);
  assert.match(publishSource, /3\. AI Generation Prompt/);
  assert.doesNotMatch(publishSource, /publish-description|publish-category|publish-negative|publish-aspect/);

  const cardSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/PromptCard.tsx'),
    'utf-8'
  );
  assert.doesNotMatch(cardSource, /prompt\.category|prompt\.shortDescription|technicalNotes/);

  const detailsSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PromptDetailsPage.tsx'),
    'utf-8'
  );
  assert.doesNotMatch(
    detailsSource,
    /prompt\.category|prompt\.fullDescription|prompt\.negativePrompt|Technical Breakdown/
  );

  const adminSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/AdminDashboardPage.tsx'),
    'utf-8'
  );
  assert.doesNotMatch(adminSource, /promptCategoryFilter|handleCreateCategory|CATEGORIES/);
  assert.match(adminSource, /Replace Image/);
});

test('15. Prompt Cards Copy Prompt, DM Sans Prompt Details, Search by Prompt, Visual Placements, and 15s Upload Timeout hold', () => {
  const clientDataSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/data/prompts.ts'),
    'utf-8'
  );
  const seededSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/server/seededPromptsData.ts'),
    'utf-8'
  );
  assert.match(clientDataSource, /READY_MADE_PROMPTS/);
  assert.match(seededSource, /RAW_READY_MADE_PROMPTS/);
  assert.doesNotMatch(seededSource, /SEEDED_PROMPT_SECRETS|promptText/);

  const cardSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/PromptCard.tsx'),
    'utf-8'
  );
  assert.match(cardSource, /aspect-\[9\/16\]/);
  assert.match(cardSource, /object-cover/);
  assert.doesNotMatch(cardSource, /Copy Prompt|View Details|prompt\.likes|prompt\.views|toggleLike/);

  const exploreSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/ExplorePage.tsx'),
    'utf-8'
  );
  assert.doesNotMatch(exploreSource, /promptText/);
  assert.match(exploreSource, /grid-cols-2/);

  const detailsSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PromptDetailsPage.tsx'),
    'utf-8'
  );
  assert.match(detailsSource, /Complete AI Generation Prompt/);
  assert.match(detailsSource, /Copy Full Prompt/);
  assert.match(detailsSource, /copyPrompt\(prompt\.id\)/);
  assert.doesNotMatch(detailsSource, /font-mono/);

  const publishSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PublishPage.tsx'),
    'utf-8'
  );
  assert.match(publishSource, /writeBatch\(db\)/);
  assert.match(publishSource, /promptSecrets/);
  assert.doesNotMatch(publishSource, /id="publish-prompt"[\s\S]*font-mono/);

  const uploadSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/imageUpload.ts'),
    'utf-8'
  );
  assert.match(uploadSource, /15000/);

  const overlaySource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualPlacementOverlay.tsx'),
    'utf-8'
  );
  assert.match(overlaySource, /\/prompt\/travertine-solstice-atrium/);
  assert.match(overlaySource, /closest\('button, input, select, textarea, label, \[role="button"\]'\)/);

  const managerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/AdsManagerWorkspace.tsx'),
    'utf-8'
  );
  assert.match(managerSource, /Preview Placement/);
  assert.match(managerSource, /Edit \/ Rename/);

  const injectorSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualAdInjector.tsx'),
    'utf-8'
  );
  assert.match(injectorSource, /ads\.map\(\(ad\) =>/);

  const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.match(serverSource, /app\.get\(\s*'\/api\/prompts\/public'/);
  assert.match(serverSource, /app\.post\(\s*'\/api\/prompts\/:promptId\/copy'/);
  assert.match(serverSource, /app\.get\(\s*'\/api\/prompts\/:promptId\/secret',\s*requireAuthToken/);
  assert.match(serverSource, /app\.get\(\s*'\/api\/admin\/prompts',\s*requireAuthToken,\s*adminGuard/);
  assert.match(serverSource, /syncPromptSecretsToPrompts/);

  const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.match(rulesSource, /match \/promptSecrets\/\{promptId\}/);
  assert.match(
    rulesSource,
    /match \/prompts\/\{promptId\}[\s\S]*allow get:[\s\S]*existing\(\)\.status == 'approved'/
  );
});

test('16. Complete Admin Prompt Control, Unified All Prompts, 3-Card Dashboard, Direct Publishing, Sitemap & RBAC Deletion Hold', () => {
  const adminSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/AdminDashboardPage.tsx'),
    'utf-8'
  );
  // Simplified 3-card overview metrics from real Firebase state
  for (const metricLabel of ['Registered Users', 'Total Prompts', 'Active Ads']) {
    assert.ok(adminSource.includes(metricLabel), `Admin overview missing card: ${metricLabel}`);
  }
  assert.doesNotMatch(adminSource, /Published Official Prompts|Pending Reviews/);

  // Navigation / tabs: All Prompts, Users Directory, Ads Manager, Reports + Super Admin links
  for (const section of [
    'All Prompts',
    'Users Directory',
    'Ads Manager',
    'Reports',
    'Admin Management',
    'Website Settings',
  ]) {
    assert.ok(adminSource.includes(section), `Admin dashboard missing section: ${section}`);
  }

  // Unified All Prompts metadata fields & 7 actions
  assert.match(adminSource, /authorEmail/);
  assert.match(adminSource, /authorUid/);
  assert.match(adminSource, /Official ImageLab prompts/);
  assert.match(adminSource, /Contributor prompts/);
  assert.match(adminSource, /Published prompts/);
  assert.match(adminSource, /Unpublished prompts/);
  for (const actionLabel of [
    'View Prompt',
    'Edit Prompt',
    'Replace Image',
    'Edit Title',
    'Edit Complete AI Prompt',
    'Unpublish',
    'Delete Permanently',
  ]) {
    assert.ok(adminSource.includes(actionLabel), `Missing Admin prompt action: ${actionLabel}`);
  }

  // Prompt Details Admin Control Panel & Owner Actions
  const detailsSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PromptDetailsPage.tsx'),
    'utf-8'
  );
  assert.match(detailsSource, /Admin Control Panel/);
  assert.match(detailsSource, /Unpublish Prompt/);
  assert.match(detailsSource, /Delete Prompt/);
  assert.match(detailsSource, /Edit My Prompt/);
  assert.match(detailsSource, /Delete My Prompt/);
  assert.match(detailsSource, /\/api\/prompts\/\$\{encodeURIComponent\(id\)\}\/manage/);

  // Direct Publishing without Pending Review gate
  const publishSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PublishPage.tsx'),
    'utf-8'
  );
  assert.match(publishSource, /status:\s*'approved'/);
  assert.doesNotMatch(publishSource, /requirePromptModeration|pending_review|Pending Review/);

  const superAdminSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/SuperAdminDashboardPage.tsx'),
    'utf-8'
  );
  assert.doesNotMatch(superAdminSource, /Require Prompt Pre-Moderation/);

  // Server complete ownership, sitemap, deletion cascade, Storage cleanup & RBAC enforcement
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.match(serverSource, /app\.get\(\s*'\/sitemap\.xml'/);
  assert.match(serverSource, /app\.get\(\s*'\/api\/prompts\/:promptId\/manage',\s*requireAuthToken/);
  assert.match(serverSource, /app\.patch\(\s*'\/api\/prompts\/:promptId',\s*requireAuthToken/);
  assert.match(serverSource, /app\.delete\(\s*'\/api\/prompts\/:promptId',\s*requireAuthToken/);
  assert.match(serverSource, /deletePromptCompletely/);
  assert.match(serverSource, /deleteStorageFileIfOwned/);
  assert.match(serverSource, /deletedPrompts/);
  assert.match(serverSource, /READY_MADE_PROMPTS/);

  // Rules allow direct contributor publish & non-public deletedPrompts tombstone
  const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.match(rulesSource, /'unpublished'/);
  assert.match(rulesSource, /match \/deletedPrompts\/\{promptId\}/);
});

test('17. Single-origin deployment config, CORS policy, no _redirects loop, and secret isolation hold', () => {
  // Cloudflare Workers SPA uses not_found_handling="single-page-application" without _redirects
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'public/_redirects')), false);

  // Ensure client code never reads or exposes FIREBASE_SERVICE_ACCOUNT_JSON
  const walkSrcFiles = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkSrcFiles(fullPath);
      return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    });
  };
  for (const filePath of walkSrcFiles(path.resolve(process.cwd(), 'src'))) {
    const contents = fs.readFileSync(filePath, 'utf-8');
    assert.doesNotMatch(
      contents,
      /(import\.meta\.env|process\.env)\.FIREBASE_SERVICE_ACCOUNT_JSON|VITE_FIREBASE_SERVICE_ACCOUNT_JSON/,
      `Client code must never read or prefix FIREBASE_SERVICE_ACCOUNT_JSON: ${filePath}`
    );
  }

  // Server health, robots, CORS, API JSON 404, dist check, and new Firebase project ID migration
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.match(serverSource, /app\.get\('\/health'/);
  assert.match(serverSource, /app\.get\('\/robots\.txt'/);
  assert.match(serverSource, /app\.use\('\/api\/\*'/);
  assert.match(serverSource, /fs\.existsSync\(indexHtmlPath\)/);
  assert.match(serverSource, /Access-Control-Allow-Origin/);
  assert.match(serverSource, /EXPECTED_FIREBASE_PROJECT_ID = 'imagelab-c612a'/);
  assert.doesNotMatch(serverSource, /imagelab-39853/);

  const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');
  assert.doesNotMatch(envExample, /imagelab-39853/);
  assert.match(envExample, /imagelab-c612a/);

  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'storage.rules')), true);
});

test('18. Production SEO, sitemap.xml, robots.txt, canonicals, and prompt-secret protection hold', async () => {
  const seoMod = await import('../scripts/generate-seo-files.mjs');
  const origin = seoMod.DEFAULT_PRODUCTION_ORIGIN;
  assert.equal(origin, 'https://imagelab.imagemart.workers.dev');

  const xml = seoMod.buildSitemapXml(origin, [
    { id: 'travertine-solstice-atrium', lastmod: '2026-11-15' },
    { id: 'harbor-line-number-twelve', lastmod: '2026-11-15' },
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/imagelab\.imagemart\.workers\.dev\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/imagelab\.imagemart\.workers\.dev\/explore<\/loc>/);
  assert.match(
    xml,
    /<loc>https:\/\/imagelab\.imagemart\.workers\.dev\/prompt\/travertine-solstice-atrium<\/loc>/
  );

  for (const excludedPath of [
    '/login',
    '/signup',
    '/admin',
    '/super-admin',
    '/dashboard',
    '/profile',
    '/saved',
    '/publish',
  ]) {
    assert.equal(
      xml.includes(`<loc>${origin}${excludedPath}</loc>`),
      false,
      `Sitemap must exclude non-public route ${excludedPath}`
    );
  }

  const robots = seoMod.buildRobotsTxt(origin);
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/imagelab\.imagemart\.workers\.dev\/sitemap\.xml$/m);
  assert.match(robots, /^Disallow: \/admin$/m);
  assert.match(robots, /^Disallow: \/login$/m);

  const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
  assert.match(indexHtml, /MqbzvNYBpO-LGkngxFkhthpJM3LTD-pV8elm2ROLjKU/);
  assert.match(
    indexHtml,
    /<link rel="canonical" href="https:\/\/imagelab\.imagemart\.workers\.dev\/" \/>/
  );
  assert.match(indexHtml, /application\/ld\+json/);

  const headersFile = fs.readFileSync(path.resolve(process.cwd(), 'public/_headers'), 'utf-8');
  assert.match(headersFile, /\/sitemap\.xml[\s\S]*Content-Type: application\/xml; charset=utf-8/);
  assert.match(headersFile, /\/robots\.txt[\s\S]*Content-Type: text\/plain; charset=utf-8/);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'public/_redirects')), false);

  // PromptDetailsPage SEO metadata must never leak protected promptText into meta or JSON-LD
  const detailsSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PromptDetailsPage.tsx'),
    'utf-8'
  );
  const seoHeadSlice = detailsSource.slice(
    detailsSource.lastIndexOf('<SeoHead'),
    detailsSource.lastIndexOf('<div className="max-w-7xl')
  );
  assert.match(seoHeadSlice, /noindex=\{!isPublished\}/);
  assert.doesNotMatch(seoHeadSlice, /promptText/);
});

test('19. Visual placement persistence fixes HTML SPA fallback, enforces dimensions/adType, prevents duplicates, and surfaces real errors', async () => {
  // 1. Dimensions & AdType validation
  const withDims = validatePlacementPayload({
    name: 'Homepage Banner Zone',
    pageRoute: '/',
    slotId: 'homepage_hero',
    selector: '[data-ad-slot="homepage_hero"]',
    elementInfo: 'Hero (<section>)',
    position: 'after',
    width: '728px',
    height: '90px',
    adType: 'banner',
    status: 'active',
    priority: 5,
  });
  assert.equal(withDims.valid, true);
  assert.equal(withDims.sanitized?.width, '728px');
  assert.equal(withDims.sanitized?.height, '90px');
  assert.equal(withDims.sanitized?.adType, 'banner');

  const badWidth = validatePlacementPayload({
    name: 'Bad Width Zone',
    pageRoute: '/',
    slotId: 'homepage_hero',
    selector: '[data-ad-slot="homepage_hero"]',
    elementInfo: 'Hero (<section>)',
    position: 'after',
    width: 'expression(alert(1))',
    height: '90px',
    adType: 'banner',
    status: 'active',
    priority: 5,
  });
  assert.equal(badWidth.valid, false);

  // 2. Duplicate placement prevention
  const existing = [
    {
      id: 'plc_existing_1',
      name: 'Homepage Below Hero',
      pageRoute: '/',
      slotId: 'homepage_hero',
      selector: '[data-ad-slot="homepage_hero"]',
      position: 'after' as const,
    },
  ];
  const dup = findDuplicatePlacement(
    {
      pageRoute: '/',
      slotId: 'homepage_hero',
      selector: '[data-ad-slot="homepage_hero"]',
      position: 'after',
    },
    existing
  );
  assert.equal(dup?.id, 'plc_existing_1');
  assert.equal(
    findDuplicatePlacement(
      {
        pageRoute: '/',
        slotId: 'homepage_hero',
        selector: '[data-ad-slot="homepage_hero"]',
        position: 'after',
      },
      existing,
      'plc_existing_1'
    ),
    null
  );
  assert.equal(
    findDuplicatePlacement(
      {
        pageRoute: '/',
        slotId: 'homepage_hero',
        selector: '[data-ad-slot="homepage_hero"]',
        position: 'before',
      },
      existing
    ),
    null
  );

  // 3. Readable error formatting unwraps JSON FirestoreErrorInfo cleanly
  assert.equal(
    formatReadableError(
      new Error(
        JSON.stringify({
          error: 'Missing or insufficient permissions.',
          operationType: 'create',
          path: 'adPlacements/plc_1',
        })
      )
    ),
    'Missing or insufficient permissions. (create adPlacements/plc_1)'
  );
  assert.equal(
    formatReadableError(new Error('Admin privileges required.'), 'Fallback'),
    'Admin privileges required.'
  );

  // 4. API client detects Cloudflare HTML SPA fallback & 503, refreshes expired 401 token, and propagates backend JSON errors
  assert.equal(isJsonContentType('text/html; charset=utf-8'), false);
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);

  const htmlFallbackResult = await callJsonApiWithFallback('/api/admin/placements', {
    method: 'POST',
    body: { name: 'Test' },
    requireAuth: true,
    getIdToken: async () => 'token-1',
    fetchImpl: async () =>
      new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  });
  assert.equal(htmlFallbackResult.apiUnavailable, true);

  const adminSdkMissingResult = await callJsonApiWithFallback('/api/admin/placements', {
    method: 'POST',
    body: { name: 'Test' },
    requireAuth: true,
    getIdToken: async () => 'token-1',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'Server Admin SDK credentials are not configured.' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  });
  assert.equal(adminSdkMissingResult.apiUnavailable, true);

  let tokenCalls = 0;
  let attempt = 0;
  const refreshedResult = await callJsonApiWithFallback<{ placement: { id: string } }>(
    '/api/admin/placements',
    {
      method: 'POST',
      body: { name: 'Test' },
      requireAuth: true,
      getIdToken: async (forceRefresh) => {
        tokenCalls += 1;
        return forceRefresh ? 'fresh-token' : 'stale-token';
      },
      fetchImpl: async (_input, init) => {
        attempt += 1;
        const authHeader = (init?.headers as Record<string, string>)?.Authorization;
        if (attempt === 1) {
          assert.equal(authHeader, 'Bearer stale-token');
          return new Response(JSON.stringify({ error: 'Token expired.' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        assert.equal(authHeader, 'Bearer fresh-token');
        return new Response(JSON.stringify({ placement: { id: 'plc_123' } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      },
    }
  );
  assert.equal(tokenCalls, 2);
  assert.equal(refreshedResult.apiUnavailable, false);
  assert.equal(refreshedResult.data?.placement.id, 'plc_123');

  await assert.rejects(
    callJsonApiWithFallback('/api/admin/placements', {
      method: 'POST',
      body: { name: 'Dup' },
      requireAuth: true,
      getIdToken: async () => 'token-1',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'A placement named "Hero" already exists.' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    }),
    /A placement named "Hero" already exists\./
  );

  // 5. Server duplicate check & publicAdSlots sync present
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.match(serverSource, /findDuplicatePlacement/);
  assert.match(serverSource, /res\.status\(409\)\.json/);
  assert.match(serverSource, /syncPublicAdSlotAdmin/);
  assert.match(serverSource, /syncPublicAdSlotsForPlacementAdmin/);
});

test('20. Simplified Ads Manager form removes Name/Provider inputs, auto-detects provider, secures Destination URL & click wrapping, and collapses empty boxes', () => {
  // 1. Safe Destination URL validation
  assert.equal(validateSafeHttpUrl('').valid, true);
  assert.equal(validateSafeHttpUrl('https://partner.example.com/offer?id=1').valid, true);
  assert.equal(validateSafeHttpUrl('http://example.com').valid, true);
  assert.equal(validateSafeHttpUrl('javascript:alert(1)').valid, false);
  assert.equal(validateSafeHttpUrl('data:text/html,<script>alert(1)</script>').valid, false);
  assert.equal(validateSafeHttpUrl('https://example.com/bad url').valid, false);

  // 2. Provider auto-detection across networks & custom banners
  assert.equal(
    detectAdProvider(`<script>atOptions = {'key':'abc','format':'iframe'};</script>`),
    'Adsterra'
  );
  assert.equal(
    detectAdProvider(`<script src="//www.highperformanceformat.com/123/invoke.js"></script>`),
    'Adsterra'
  );
  assert.equal(
    detectAdProvider(`<ins class="adsbygoogle"></ins><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>`),
    'Google AdSense'
  );
  assert.equal(
    detectAdProvider(`<script src="https://alwingulla.com/88/tag.min.js"></script>`),
    'Monetag'
  );
  assert.equal(detectAdProvider(`<script src="https://cdn.example.net/ads.js"></script>`), 'Generic Ad Network');
  assert.equal(detectAdProvider('https://cdn.example.com/banner-728x90.webp'), 'Custom Banner');
  assert.equal(detectAdProvider(`<img src="https://cdn.example.com/b.png" />`), 'Custom Banner');
  assert.equal(detectAdProvider(`<div>Sponsored Studio Offer</div>`), 'Custom Ad');

  // 3. validateAdPayload succeeds WITHOUT name or provider inputs and derives them cleanly
  const adsterraCheck = validateAdPayload(
    {
      adType: 'banner',
      placementId: 'plc_hero_1',
      width: '728px',
      height: '90px',
      status: 'active',
      priority: 5,
      scriptCode: `<script>atOptions = {'key':'abc'};</script><script src="//www.highperformanceformat.com/abc/invoke.js"></script>`,
    },
    { placementName: 'Homepage Below Hero' }
  );
  assert.equal(adsterraCheck.valid, true);
  assert.equal(adsterraCheck.sanitized?.provider, 'Adsterra');
  assert.equal(adsterraCheck.sanitized?.name, 'Adsterra · Homepage Below Hero');
  assert.equal(adsterraCheck.sanitized?.destinationUrl, '');

  const customBannerCheck = validateAdPayload(
    {
      adType: 'banner',
      placementId: 'plc_footer_1',
      width: '300px',
      height: '250px',
      status: 'active',
      priority: 12,
      destinationUrl: 'https://sponsor.example.com/deals',
      scriptCode: 'https://cdn.example.com/ad-300x250.png',
    },
    { placementName: 'Footer Banner' }
  );
  assert.equal(customBannerCheck.valid, true);
  assert.equal(customBannerCheck.sanitized?.provider, 'Custom Banner');
  assert.equal(customBannerCheck.sanitized?.name, 'Custom Banner · Footer Banner');
  assert.equal(customBannerCheck.sanitized?.destinationUrl, 'https://sponsor.example.com/deals');

  const unsafeDestCheck = validateAdPayload({
    adType: 'banner',
    placementId: 'plc_footer_1',
    width: '300px',
    height: '250px',
    status: 'active',
    priority: 10,
    destinationUrl: 'javascript:alert(document.cookie)',
    scriptCode: '<img src="https://cdn.example.com/ad.png" />',
  });
  assert.equal(unsafeDestCheck.valid, false);

  // 4. Click behavior & sandbox isolation in buildSandboxedAdSrcDoc
  assert.equal(hasOwnInteractiveOrScriptElements('<img src="https://cdn.example.com/ad.png" />'), false);
  assert.equal(
    hasOwnInteractiveOrScriptElements('<a href="https://native.example.com"><img src="https://cdn.example.com/ad.png" /></a>'),
    true
  );
  assert.equal(
    hasOwnInteractiveOrScriptElements('<script src="//www.highperformanceformat.com/x/invoke.js"></script>'),
    true
  );

  // Direct image URL + destinationUrl -> normalized to <img> and wrapped in target="_blank" link
  const directBannerHtml = buildSandboxedAdSrcDoc({
    id: 'ad_custom_1',
    name: 'Custom Banner',
    provider: 'Custom Banner',
    adType: 'banner',
    scriptCode: 'https://cdn.example.com/promo.webp',
    destinationUrl: 'https://landing.example.com/?ref=imagelab',
    placementId: 'plc_1',
    width: '728px',
    height: '90px',
    status: 'active',
    priority: 1,
    createdAt: '',
    updatedAt: '',
  });
  assert.match(directBannerHtml, /<base target="_blank" rel="noopener noreferrer" \/>/);
  assert.match(
    directBannerHtml,
    /<a class="imagelab-ad-link" href="https:\/\/landing\.example\.com\/\?ref=imagelab" target="_blank" rel="noopener noreferrer"><img src="https:\/\/cdn\.example\.com\/promo\.webp"/
  );

  // Custom HTML already having <a> + destinationUrl -> preserves original anchor without double-wrapping
  const existingLinkHtml = buildSandboxedAdSrcDoc({
    id: 'ad_html_1',
    name: 'Custom Ad',
    provider: 'Custom Ad',
    adType: 'custom_html_js',
    scriptCode: '<a href="https://original.example.com"><span>Click Original</span></a>',
    destinationUrl: 'https://override-should-not-wrap.example.com',
    placementId: 'plc_1',
    width: 'auto',
    height: 'auto',
    status: 'active',
    priority: 1,
    createdAt: '',
    updatedAt: '',
  });
  assert.doesNotMatch(existingLinkHtml, /class="imagelab-ad-link"/);
  assert.doesNotMatch(existingLinkHtml, /override-should-not-wrap/);
  assert.match(existingLinkHtml, /href="https:\/\/original\.example\.com"/);

  // Adsterra script + destinationUrl -> preserves script untouched without wrapping
  const adsterraHtml = buildSandboxedAdSrcDoc({
    id: 'ad_adsterra_1',
    name: 'Adsterra Banner',
    provider: 'Adsterra',
    adType: 'banner',
    scriptCode: `<script type="text/javascript">atOptions={'key':'k1'};</script><script src="//www.highperformanceformat.com/k1/invoke.js"></script>`,
    destinationUrl: 'https://ignored-when-script.example.com',
    placementId: 'plc_1',
    width: '300px',
    height: '250px',
    status: 'active',
    priority: 1,
    createdAt: '',
    updatedAt: '',
  });
  assert.doesNotMatch(adsterraHtml, /class="imagelab-ad-link"/);
  assert.doesNotMatch(adsterraHtml, /ignored-when-script/);
  assert.match(adsterraHtml, /highperformanceformat\.com\/k1\/invoke\.js/);

  // normalizeCreativeMarkup leaves HTML untouched and converts standalone image URL
  assert.match(normalizeCreativeMarkup('https://cdn.example.com/a.jpg'), /^<img src="https:\/\/cdn\.example\.com\/a\.jpg"/);
  assert.equal(normalizeCreativeMarkup('<div>Hi</div>'), '<div>Hi</div>');

  // 5. Simplified Add/Edit modal removes Name & Provider inputs while keeping Destination URL & Live Preview
  const workspaceSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/AdsManagerWorkspace.tsx'),
    'utf-8'
  );
  const modalSlice = workspaceSource.slice(workspaceSource.indexOf('{/* Create / Edit Advertisement Modal */}'));
  assert.doesNotMatch(modalSlice, /Advertisement Name/);
  assert.doesNotMatch(modalSlice, /Ad Provider/);
  assert.match(modalSlice, /Destination URL/);
  assert.match(modalSlice, /Preview Advertisement/);
  assert.match(modalSlice, /Selected Website Placement/);

  // 6. Public empty-ad collapsing & VisualPlacementOverlay preview + return route preservation
  const adSlotSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AdSlot.tsx'), 'utf-8');
  assert.match(adSlotSource, /LivePublicAdItem/);
  assert.match(adSlotSource, /if \(status === 'empty' \|\| status === 'error'\) \{\s*return null;\s*\}/);
  assert.match(adSlotSource, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(adSlotSource, /allow-same-origin/);

  const injectorSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualAdInjector.tsx'),
    'utf-8'
  );
  assert.match(injectorSource, /PlacementAdPortalGroup/);
  assert.match(injectorSource, /hasAnyVisible/);
  assert.match(injectorSource, /h-0 overflow-hidden m-0 p-0/);

  const overlaySource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualPlacementOverlay.tsx'),
    'utf-8'
  );
  assert.match(overlaySource, /Preview Slot Area on Page|Preview Your Draft Ad Inside This Area/);
  assert.match(overlaySource, /returnTo/);
});

test('21. Two-column 9:16 Instagram-style gallery, image-only tiles, authenticated Copy Full Prompt, and strict prompt-secret isolation hold', async () => {
  // 1. PromptCard & SkeletonCard strictly enforce 9:16 portrait cover with zero text/metadata below
  const cardSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PromptCard.tsx'), 'utf-8');
  assert.match(cardSource, /aspect-\[9\/16\]/);
  assert.match(cardSource, /object-cover/);
  assert.doesNotMatch(cardSource, /<h[1-6]|<p\b|<button\b|likes|views|copies|promptText/);

  const skeletonSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/FeedbackStates.tsx'), 'utf-8');
  assert.match(skeletonSource, /aspect-\[9\/16\]/);
  assert.doesNotMatch(skeletonSource, /aspect-\[4\/3\]|aspect-square/);

  // 2. Public galleries consistently use 2-column grid layout & strict 9:16 previews while preserving ad slots
  for (const relPath of [
    'src/pages/HomePage.tsx',
    'src/pages/ExplorePage.tsx',
    'src/pages/TrendingPage.tsx',
    'src/pages/SavedPromptsPage.tsx',
    'src/pages/ProfilePage.tsx',
    'src/pages/PromptDetailsPage.tsx',
  ]) {
    const src = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
    assert.match(src, /grid-cols-2/, `${relPath} must use 2-column gallery grid`);
  }

  const homeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/HomePage.tsx'), 'utf-8');
  assert.match(homeSource, /data-ad-slot="homepage_trending"/);
  assert.match(homeSource, /data-ad-slot="homepage_gallery"/);
  assert.doesNotMatch(homeSource, /aspect-\[4\/3\]|aspect-\[16\/10\]/);

  const trendingSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/TrendingPage.tsx'), 'utf-8');
  assert.match(trendingSource, /aspect-\[9\/16\]/);
  assert.doesNotMatch(trendingSource, /aspect-\[16\/10\]/);

  // 3. PromptDetailsPage displays 9:16 portrait image, single Copy Full Prompt button, redirect for guests, & confirmation
  const detailsSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PromptDetailsPage.tsx'), 'utf-8');
  assert.match(detailsSource, /aspect-\[9\/16\]/);
  const copyMatches = detailsSource.match(/Copy Full Prompt/g) || [];
  assert.ok(copyMatches.length >= 1);
  assert.doesNotMatch(detailsSource, />\s*Copy Prompt\s*</);
  assert.match(detailsSource, /\/signup\?redirect=/);
  assert.match(detailsSource, /imagelab_post_auth_redirect/);
  assert.match(detailsSource, /Prompt copied successfully/);

  // 4. Secret prompts are completely excluded from client-bundled data and public Firestore writes
  const { SEEDED_PROMPT_SECRETS } = await import('../src/server/seededPromptSecrets.ts');
  const seededClientSource = fs.readFileSync(path.resolve(process.cwd(), 'src/server/seededPromptsData.ts'), 'utf-8');
  for (const secretValue of Object.values(SEEDED_PROMPT_SECRETS)) {
    const snippet = secretValue.slice(0, 32);
    assert.equal(seededClientSource.includes(snippet), false, 'Client seeded data must never contain secret prompt strings');
  }

  const publishSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PublishPage.tsx'), 'utf-8');
  const publicBatchSlice = publishSource.slice(
    publishSource.indexOf("batch.set(doc(db, 'prompts'"),
    publishSource.indexOf("batch.set(doc(db, 'promptSecrets'")
  );
  assert.doesNotMatch(publicBatchSlice, /promptText/);

  const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  const sanitizeSlice = serverSource.slice(
    serverSource.indexOf('const sanitizePublicPrompt'),
    serverSource.indexOf('const resolveCanonicalSiteOrigin')
  );
  assert.doesNotMatch(sanitizeSlice, /promptText/);

  const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
  assert.match(rulesSource, /!\('promptText' in incoming\(\)\)/);
});

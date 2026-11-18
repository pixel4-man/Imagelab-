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
  normalizePageRoute,
  normalizeSlotIdentifier,
  validateAdPayload,
  validatePlacementPayload,
} from '../src/types/ads.ts';
import { buildAllowedOrigins, isOriginAllowed } from '../src/server/cors.ts';

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
  assert.match(injectorSource, /SandboxedAdFrame/);

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
  assert.match(seededSource, /promptText:/);

  const cardSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/PromptCard.tsx'),
    'utf-8'
  );
  assert.match(cardSource, /Copy Prompt/);
  assert.match(cardSource, /copyPrompt\(prompt\.id\)/);
  assert.match(cardSource, /View Details/);

  const exploreSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/ExplorePage.tsx'),
    'utf-8'
  );
  assert.match(exploreSource, /\(item\.promptText \|\| ''\)\.toLowerCase\(\)\.includes\(q\)/);

  const detailsSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/PromptDetailsPage.tsx'),
    'utf-8'
  );
  assert.match(detailsSource, /Complete AI Generation Prompt/);
  assert.match(detailsSource, /Copy Prompt/);
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

test('17. Cloudflare Pages SPA fallback, CORS policy, VITE_API_BASE_URL routing, SEO files, and secret isolation hold', () => {
  // CORS production allowlist blocks unknown origins and localhost in production
  const prodOrigins = buildAllowedOrigins({
    allowedOrigins: 'https://imagelab.pages.dev, https://*.imagelab.pages.dev',
    siteUrl: 'https://imagelab.example.com/',
    nodeEnv: 'production',
  });
  assert.equal(isOriginAllowed('https://imagelab.pages.dev', prodOrigins).allowed, true);
  assert.equal(isOriginAllowed('https://abc123.imagelab.pages.dev', prodOrigins).allowed, true);
  assert.equal(isOriginAllowed('https://imagelab.example.com', prodOrigins).allowed, true);
  assert.equal(isOriginAllowed('http://localhost:3000', prodOrigins).allowed, false);
  assert.equal(isOriginAllowed('https://evil.example.org', prodOrigins).allowed, false);
  assert.equal(isOriginAllowed(undefined, prodOrigins).allowed, true);

  // Wildcard "*" alone must never grant CORS access
  assert.equal(isOriginAllowed('https://evil.example.org', ['*']).allowed, false);

  // Local dev mode enables localhost origins automatically
  const devOrigins = buildAllowedOrigins({ nodeEnv: 'development' });
  assert.equal(isOriginAllowed('http://localhost:3000', devOrigins).allowed, true);
  assert.equal(isOriginAllowed('http://localhost:5173', devOrigins).allowed, true);

  // Cloudflare Workers SPA uses wrangler.jsonc not_found_handling="single-page-application" without _redirects
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'public/_redirects')), false);

  const headers = fs.readFileSync(path.resolve(process.cwd(), 'public/_headers'), 'utf-8');
  assert.match(headers, /Cross-Origin-Opener-Policy:\s*same-origin-allow-popups/);
  assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/);

  // API base helper uses VITE_API_BASE_URL
  const apiHelperSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/api.ts'),
    'utf-8'
  );
  assert.match(apiHelperSource, /import\.meta\.env\.VITE_API_BASE_URL/);

  // Ensure zero raw fetch('/api/...') calls bypass apiUrl() across client code
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
      /fetch\(['"`]\/api\//,
      `Raw unprefixed fetch('/api/...') found in ${filePath}`
    );
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


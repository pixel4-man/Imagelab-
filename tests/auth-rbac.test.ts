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
  extractAtOptionsMetadata,
  hasOwnInteractiveOrScriptElements,
  normalizeCreativeMarkup,
  normalizePageRoute,
  validateSafeHttpUrl,
} from '../src/types/ads.ts';
import {
  buildSandboxedAdSrcDoc,
  preprocessCreativeForSandbox,
} from '../src/lib/adFrameHtml.ts';
import {
  ADSTERRA_ZONES,
  ADSTERRA_ZONES_BY_ID,
  BUILTIN_AD_PLACEMENTS,
  buildAdsterraZoneScript,
  buildDefaultAdsterraAdRecord,
  extractAdsterraZoneKey,
  getBuiltinAdsterraState,
  getPlacementDeviceTarget,
} from '../src/lib/adsterraZones.ts';
import {
  computeShelfCardTransform,
  computeShelfOffset,
  deriveShelfCategories,
  formatPublicEditorialSubtitle,
  getPreloadIndices,
  resolveSwipeStep,
  stepShelfIndex,
} from '../src/lib/landingShelf.ts';
import { READY_MADE_PROMPTS } from '../src/server/seededPromptsData.ts';

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

test('10. Route normalization, provider detection, and Ads Manager complete removal hold', () => {
  assert.equal(normalizePageRoute('/explore/?q=test#top'), '/explore');
  assert.equal(normalizePageRoute('trending'), '/trending');
  assert.equal(detectAdProvider('https://bicea.org/22/9bf275cec2fca23dd811c4ea8b659006'), 'Adsterra');

  for (const deletedFile of [
    'src/pages/AdsManagerPage.tsx',
    'src/components/AdsManagerWorkspace.tsx',
    'src/components/VisualPlacementOverlay.tsx',
    'src/context/PlacementSelectorContext.tsx',
    'src/lib/adsApiClient.ts',
  ]) {
    assert.equal(
      fs.existsSync(path.resolve(process.cwd(), deletedFile)),
      false,
      `Deleted Ads Manager file must not exist: ${deletedFile}`
    );
  }

  for (const activeFile of [
    'src/App.tsx',
    'src/components/Navbar.tsx',
    'src/pages/AdminDashboardPage.tsx',
    'src/pages/SuperAdminDashboardPage.tsx',
    'src/pages/ProfilePage.tsx',
    'src/components/AdSlot.tsx',
    'src/components/VisualAdInjector.tsx',
    'src/lib/adsPersistence.ts',
    'server.ts',
  ]) {
    const content = fs.readFileSync(path.resolve(process.cwd(), activeFile), 'utf-8');
    assert.doesNotMatch(
      content,
      /AdsManager|PlacementSelector|VisualPlacementOverlay|\/admin\/ads|adsApiClient/,
      `File must not reference removed Ads Manager symbols: ${activeFile}`
    );
  }
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
    'src/pages/SuperAdminDashboardPage.tsx',
    'src/pages/DashboardPage.tsx',
    'src/pages/LegalPage.tsx',
  ]) {
    const pageSource = fs.readFileSync(path.resolve(process.cwd(), pageFile), 'utf-8');
    assert.match(pageSource, /<BackButton/, `Expected BackButton in ${pageFile}`);
  }
});

test('12. Predefined public ad placement slots wire safely to VisualAdInjector and strict sandboxed AdSlot frames', () => {
  const injectorSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualAdInjector.tsx'),
    'utf-8'
  );
  assert.match(injectorSource, /createPortal/);
  assert.match(injectorSource, /getPredefinedActiveAdState/);
  assert.match(injectorSource, /isPublicAdRoute/);
  assert.match(injectorSource, /LivePublicAdItem/);
  assert.doesNotMatch(injectorSource, /fetch\(/);

  const adSlotSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/AdSlot.tsx'),
    'utf-8'
  );
  assert.match(adSlotSource, /sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(adSlotSource, /allow-same-origin/);
  assert.doesNotMatch(adSlotSource, /\/api\/ads\/active/);

  const anchorSources = [
    'src/App.tsx',
    'src/pages/HomePage.tsx',
    'src/pages/ExplorePage.tsx',
  ]
    .map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8'))
    .join('\n');

  for (const expectedSlot of [
    'desktop_header_banner',
    'mobile_header_banner',
    'desktop_homepage_banner',
    'homepage_gallery_banner',
    'desktop_sidebar_banner',
  ]) {
    assert.ok(
      anchorSources.includes(`data-ad-slot="${expectedSlot}"`),
      `Missing data-ad-slot="${expectedSlot}" anchor`
    );
  }
});

test('13. Server removes obsolete ad-management endpoints while enforcing adminGuard on prompt moderation routes', () => {
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.doesNotMatch(serverSource, /\/api\/ads\/active/);
  assert.doesNotMatch(serverSource, /\/api\/admin\/placements/);
  assert.doesNotMatch(serverSource, /\/api\/admin\/ads/);
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
  for (const metricLabel of ['Registered Users', 'Total Prompts', 'Reports']) {
    assert.ok(adminSource.includes(metricLabel), `Admin overview missing card: ${metricLabel}`);
  }
  assert.doesNotMatch(adminSource, /Published Official Prompts|Pending Reviews|Active Ads|Ads Manager/);

  // Navigation / tabs: All Prompts, Users Directory, Reports + Super Admin links
  for (const section of [
    'All Prompts',
    'Users Directory',
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

test('19. Automatic ad state loads purely from source-code configuration without Firestore or Ads Manager API calls', () => {
  const persistenceSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/adsPersistence.ts'),
    'utf-8'
  );
  assert.match(persistenceSource, /getBuiltinAdsterraState/);
  assert.doesNotMatch(persistenceSource, /collection\(db,\s*'ads'\)|adPlacements|publicAdSlots|\/api\/admin\/ads/);

  const state = getBuiltinAdsterraState();
  assert.equal(state.placements.length, 5);
  assert.equal(state.ads.length, 5);
  for (const placement of state.placements) {
    assert.equal(placement.status, 'active');
  }
  for (const ad of state.ads) {
    assert.equal(ad.status, 'active');
    assert.equal(ad.provider, 'Adsterra');
  }
});

test('20. Sandboxed AdSlot preserves URL safety, provider detection, no-inventory collapsing, and zero-false-positive visibility', () => {
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
    detectAdProvider(`<script src="//bicea.org/22/9bf275cec2fca23dd811c4ea8b659006"></script>`),
    'Adsterra'
  );
  assert.equal(detectAdProvider(`<script src="https://cdn.example.net/ads.js"></script>`), 'Generic Ad Network');
  assert.equal(detectAdProvider('https://cdn.example.com/banner-728x90.webp'), 'Custom Banner');
  assert.equal(detectAdProvider(`<img src="https://cdn.example.com/b.png" />`), 'Custom Banner');
  assert.equal(detectAdProvider(`<div>Sponsored Studio Offer</div>`), 'Custom Ad');

  // 3. Click behavior & sandbox isolation in buildSandboxedAdSrcDoc
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

  // Adsterra script preserves invocation untouched without wrapping
  const adsterraHtml = buildSandboxedAdSrcDoc({
    id: 'ad_adsterra_1',
    name: 'Adsterra Banner',
    provider: 'Adsterra',
    adType: 'banner',
    scriptCode: `<script type="text/javascript">var atOptions={'key':'k1'};</script><script src="https://bicea.org/22/k1"></script>`,
    destinationUrl: '',
    placementId: 'plc_1',
    width: '300px',
    height: '250px',
    status: 'active',
    priority: 1,
    createdAt: '',
    updatedAt: '',
  });
  assert.doesNotMatch(adsterraHtml, /class="imagelab-ad-link"/);
  assert.match(adsterraHtml, /bicea\.org\/22\/k1/);

  // normalizeCreativeMarkup leaves HTML untouched and converts standalone image URL
  assert.match(normalizeCreativeMarkup('https://cdn.example.com/a.jpg'), /^<img src="https:\/\/cdn\.example\.com\/a\.jpg"/);
  assert.equal(normalizeCreativeMarkup('<div>Hi</div>'), '<div>Hi</div>');

  // 4. Public empty-ad collapsing on real errors/no-fill/rendering_blocked while keeping strict sandbox
  const adSlotSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AdSlot.tsx'), 'utf-8');
  assert.match(adSlotSource, /LivePublicAdItem/);
  assert.match(
    adSlotSource,
    /TERMINAL_FAILED_STATUSES[\s\S]*'no_inventory'[\s\S]*'rendering_blocked'[\s\S]*'script_blocked'[\s\S]*'error'/
  );
  assert.match(
    adSlotSource,
    /isVisible = status === 'loaded' \|\| status === 'preview_unsupported'/
  );
  assert.match(adSlotSource, /sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(adSlotSource, /allow-same-origin/);

  const injectorSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/VisualAdInjector.tsx'),
    'utf-8'
  );
  assert.match(injectorSource, /PlacementAdPortalGroup/);
  assert.match(injectorSource, /hasAnyVisible/);
  assert.match(injectorSource, /h-0 overflow-hidden m-0 p-0/);
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

test('22. Adsterra official code parsing, friendly about:blank isolation bridge, audience safety filtering, zero-false-positive visibility probe, and full diagnostics hold', () => {
  // 1. Official Adsterra atOptions metadata extraction
  const officialAdsterraSnippet = `
    <script type="text/javascript">
      const atOptions = {
        'key' : 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        'format' : 'iframe',
        'height' : 250,
        'width' : 300,
        'params' : {}
      };
      document.write('<scr' + 'ipt type="text/javascript" src="http' + (location.protocol === 'https:' ? 's' : '') + '://www.highperformanceformat.com/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4/invoke.js"></scr' + 'ipt>');
    </script>
  `;
  const meta = extractAtOptionsMetadata(officialAdsterraSnippet);
  assert.equal(meta.key, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
  assert.equal(meta.format, 'iframe');
  assert.equal(meta.width, '300px');
  assert.equal(meta.height, '250px');
  assert.equal(detectAdProvider(officialAdsterraSnippet), 'Adsterra');

  // 2. Preprocessor fixes about:srcdoc protocol downgrade & block-scoped atOptions while preserving execution order
  const preprocessed = preprocessCreativeForSandbox(officialAdsterraSnippet, { isHttps: true });
  assert.match(preprocessed, /\bvar atOptions\b/);
  assert.doesNotMatch(preprocessed, /\bconst atOptions\b/);
  assert.match(preprocessed, /'s'/);
  assert.doesNotMatch(preprocessed, /location\.protocol === 'https:' \? 's' : ''/);

  const twoTagAdsterra = `<script>atOptions={'key':'k12345678','format':'iframe','height':90,'width':728,'params':{}};</script><script src="//www.topcreativeformat.com/k12345678/invoke.js"></script>`;
  const preprocessedTwoTag = preprocessCreativeForSandbox(twoTagAdsterra, { isHttps: true });
  assert.match(preprocessedTwoTag, /https:\/\/www\.topcreativeformat\.com\/k12345678\/invoke\.js/);
  assert.ok(
    preprocessedTwoTag.indexOf('atOptions=') < preprocessedTwoTag.indexOf('invoke.js'),
    'atOptions configuration must execute before external invoke.js'
  );

  // 3. Sandboxed srcDoc includes storage/cookie isolation shims, friendly about:blank srcdoc bridge, CORS monitoring, and zero-false-positive detection
  const srcDoc = buildSandboxedAdSrcDoc(
    {
      id: 'ad_adsterra_probe_1',
      name: 'Adsterra Test',
      provider: 'Adsterra',
      adType: 'banner',
      scriptCode: officialAdsterraSnippet,
      placementId: 'plc_1',
      width: 'auto',
      height: 'auto',
      status: 'active',
      priority: 1,
      createdAt: '',
      updatedAt: '',
    },
    { isHttps: true }
  );

  assert.match(srcDoc, /min-width:\s*300px/);
  assert.match(srcDoc, /min-height:\s*250px/);
  assert.match(srcDoc, /createMemoryStorage/);
  assert.match(srcDoc, /installFriendlyBlankIframeBridge/);
  assert.match(srcDoc, /appendMarkupSafelyAfterLoad/);
  assert.match(srcDoc, /securitypolicyviolation/);
  // Must NEVER treat an empty about:blank nested <iframe> tag alone as 'loaded' or 'preview_unsupported'
  assert.match(srcDoc, /NEVER treat an <iframe> tag or empty about:blank frame as rendered visible creative/);
  assert.match(srcDoc, /postStatus\(\s*'script_request_started'/);
  assert.match(srcDoc, /postStatus\(\s*'script_loaded'/);
  assert.match(srcDoc, /postStatus\(\s*'iframe_created'/);
  assert.match(srcDoc, /postStatus\(\s*'loaded'/);
  assert.match(srcDoc, /postStatus\(\s*'rendering_blocked'/);
  assert.match(srcDoc, /postStatus\(\s*'script_blocked'/);
  assert.match(srcDoc, /postStatus\(\s*'timeout'/);
  assert.match(srcDoc, /postStatus\(\s*'error'/);
  assert.match(srcDoc, /postStatus\(\s*'preview_unsupported'/);
  assert.match(srcDoc, /postStatus\(\s*'no_inventory'/);
  assert.match(srcDoc, /postStatus\(\s*'popunder_ready'/);

  // Extended non-premature probe window (8s initial + 12s pending grace) and structured per-zone diagnostics
  assert.match(srcDoc, /run\(true\);\s*\},\s*8000\)/);
  assert.match(srcDoc, /12000\s*-\s*elapsed/);
  assert.match(srcDoc, /imagelab-ad-diagnostic/);
  for (const diagEvent of [
    'script_request_started',
    'script_loaded',
    'script_failed',
    'nested_iframe_created',
    'creative_rendered',
    'empty_response',
    'timeout',
    'browser_restriction',
  ]) {
    assert.ok(srcDoc.includes(`'${diagEvent}'`), `Missing diagnostic milestone: ${diagEvent}`);
  }

  // 4. URL hygiene validation strips invisible formatting characters
  const dirtyUrlCheck = validateSafeHttpUrl('https://example.com/offer\u2060');
  assert.equal(dirtyUrlCheck.valid, true);
  assert.equal(dirtyUrlCheck.sanitized, 'https://example.com/offer');

  // 5. AdSlot enforces strict sandbox isolation and exposes per-unit render status diagnostics
  const adSlotSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AdSlot.tsx'), 'utf-8');
  assert.doesNotMatch(adSlotSource, /allow-same-origin/);
  assert.doesNotMatch(adSlotSource, /Creative rendered inside sandboxed iframe/);
  assert.match(adSlotSource, /data-imagelab-ad-unit/);
  assert.match(adSlotSource, /data-ad-zone-key/);
  assert.match(adSlotSource, /data-ad-render-status/);
  assert.match(adSlotSource, /__imagelabAdDiagnostics/);
  assert.match(adSlotSource, /imagelab-ad-diagnostic/);
  assert.match(adSlotSource, /ResizeObserver/);
  assert.match(adSlotSource, /frame\.removeAttribute\('srcdoc'\)/);
});

test('23. Five exact automatic Adsterra zones, independent sandbox lifecycles, responsive viewport gating, and public-only routing hold', () => {
  // 1. Exact 5 supplied Adsterra zones (keys, script URLs, sizes, default placements)
  assert.equal(ADSTERRA_ZONES.length, 5);
  assert.deepEqual(
    ADSTERRA_ZONES.map((z) => ({
      zoneNumber: z.zoneNumber,
      zoneKey: z.zoneKey,
      scriptUrl: z.scriptUrl,
      width: z.width,
      height: z.height,
      deviceTarget: z.deviceTarget,
    })),
    [
      {
        zoneNumber: 1,
        zoneKey: '9bf275cec2fca23dd811c4ea8b659006',
        scriptUrl: 'https://bicea.org/22/9bf275cec2fca23dd811c4ea8b659006',
        width: '468px',
        height: '60px',
        deviceTarget: 'desktop',
      },
      {
        zoneNumber: 2,
        zoneKey: '8f006a55a574a4657b9c0b877e503a54',
        scriptUrl: 'https://bicea.org/22/8f006a55a574a4657b9c0b877e503a54',
        width: '728px',
        height: '90px',
        deviceTarget: 'desktop',
      },
      {
        zoneNumber: 3,
        zoneKey: '1c30969d7c004ca503ae6460010eb760',
        scriptUrl: 'https://bicea.org/22/1c30969d7c004ca503ae6460010eb760',
        width: '320px',
        height: '50px',
        deviceTarget: 'mobile',
      },
      {
        zoneNumber: 4,
        zoneKey: '4606ed44271ecec8b5f053ee87806f78',
        scriptUrl: 'https://bicea.org/22/4606ed44271ecec8b5f053ee87806f78',
        width: '160px',
        height: '600px',
        deviceTarget: 'desktop',
      },
      {
        zoneNumber: 5,
        zoneKey: '873ad292a31a1a1dee93fce99c7c7ff0',
        scriptUrl: 'https://bicea.org/22/873ad292a31a1a1dee93fce99c7c7ff0',
        width: '300px',
        height: '250px',
        deviceTarget: 'all',
      },
    ]
  );

  // 2. Each zone builds an independent atOptions script + isolated srcDoc with deduplication & unload cleanup
  for (const zone of ADSTERRA_ZONES) {
    assert.equal(ADSTERRA_ZONES_BY_ID.has(zone.id), true);
    const script = buildAdsterraZoneScript(zone);
    assert.match(script, /\batOptions\s*=\s*\{/);
    assert.match(script, new RegExp(`'key'\\s*:\\s*'${zone.zoneKey}'`));
    assert.match(script, /'format'\s*:\s*'iframe'/);
    assert.match(script, new RegExp(`'height'\\s*:\\s*${zone.heightPx}`));
    assert.match(script, new RegExp(`'width'\\s*:\\s*${zone.widthPx}`));
    assert.match(script, /'params'\s*:\s*\{\}/);
    assert.ok(script.includes(`<script src="${zone.scriptUrl}"></script>`));
    assert.ok(script.indexOf('atOptions = {') < script.indexOf(zone.scriptUrl));

    const adRec = buildDefaultAdsterraAdRecord(zone);
    assert.equal(extractAdsterraZoneKey(adRec), zone.zoneKey);
    const frameHtml = buildSandboxedAdSrcDoc(adRec, { isHttps: true });
    assert.match(frameHtml, new RegExp(zone.zoneKey));
    assert.match(frameHtml, /seenScriptUrls/);
    assert.match(frameHtml, /pagehide/);
    assert.match(frameHtml, /disposeAll/);
  }

  // 3. Static predefined state matches the 5 placements & 5 zones cleanly
  const builtinState = getBuiltinAdsterraState();
  assert.equal(builtinState.placements.length, 5);
  assert.equal(builtinState.ads.length, 5);

  // 4. Responsive viewport routing prevents desktop/mobile double-loading
  assert.equal(getPlacementDeviceTarget(BUILTIN_AD_PLACEMENTS[0]), 'desktop'); // 468x60 desktop header
  assert.equal(getPlacementDeviceTarget(BUILTIN_AD_PLACEMENTS[1]), 'mobile'); // 320x50 mobile header
  assert.equal(getPlacementDeviceTarget(BUILTIN_AD_PLACEMENTS[2]), 'desktop'); // 728x90 desktop home
  assert.equal(getPlacementDeviceTarget(BUILTIN_AD_PLACEMENTS[3]), 'all'); // 300x250 content gallery
  assert.equal(getPlacementDeviceTarget(BUILTIN_AD_PLACEMENTS[4]), 'desktop'); // 160x600 desktop sidebar

  // 5. Required DOM placement slots, responsive classes, host reuse, and public-only gating exist
  const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  assert.match(appSource, /showPublicAds &&/);
  assert.match(appSource, /data-ad-slot="desktop_header_banner"/);
  assert.match(appSource, /data-ad-slot="mobile_header_banner"/);
  assert.doesNotMatch(appSource, /\/admin\/ads/);

  const homeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/HomePage.tsx'), 'utf-8');
  assert.match(homeSource, /data-ad-slot="desktop_homepage_banner"/);
  assert.match(homeSource, /data-ad-slot="homepage_gallery_banner"/);
  assert.match(homeSource, /data-ad-slot="desktop_sidebar_banner"/);

  const injectorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/VisualAdInjector.tsx'), 'utf-8');
  assert.match(injectorSource, /matchMedia\('\(min-width: 1024px\)'\)/);
  assert.match(injectorSource, /seenZoneKeys/);
  assert.match(injectorSource, /isPublicAdRoute/);
  assert.match(injectorSource, /\['\/admin', '\/super-admin', '\/login', '\/signup'\]/);
  assert.doesNotMatch(injectorSource, /location\.search/);

  const adSlotSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AdSlot.tsx'), 'utf-8');
  assert.match(adSlotSource, /aspectRatio/);
  assert.match(adSlotSource, /frame\.src = 'about:blank'/);
  assert.match(adSlotSource, /onStatusChange\?:\s*\(status:\s*AdRenderStatus/);
  assert.match(adSlotSource, /'timeout'/);
});

test('24. Interactive 3D ImageLab landing shelf, real category filtering, responsive geometry, fine-pointer cursor, and prompt privacy hold', () => {
  // 1. Real category derivation never creates empty or fake categories
  assert.deepEqual(deriveShelfCategories([]), []);
  const categories = deriveShelfCategories(READY_MADE_PROMPTS);
  assert.ok(categories.length >= 4);
  for (const cat of categories) {
    assert.ok(cat.items.length > 0, `Category ${cat.id} must have >= 1 item`);
  }
  assert.equal(categories.some((c) => c.id === 'community'), false);

  // 2. Wrap-around stepping, circular shelf offsets, swipe direction, and preload indices
  assert.equal(stepShelfIndex(0, -1, 14), 13);
  assert.equal(stepShelfIndex(13, 1, 14), 0);
  assert.equal(computeShelfOffset(13, 0, 14), -1);
  assert.equal(computeShelfOffset(0, 13, 14), 1);
  assert.equal(resolveSwipeStep(-60), 1);
  assert.equal(resolveSwipeStep(60), -1);
  assert.equal(resolveSwipeStep(12), 0);
  assert.deepEqual(getPreloadIndices(0, 14), [13, 0, 1]);

  // 3. 3D card transform focuses active item forward facing viewer, angles neighbors, and flattens on reduced motion
  for (const vpWidth of [360, 390, 430, 768, 1024, 1440]) {
    const activeTx = computeShelfCardTransform(0, {
      cardWidth: vpWidth < 640 ? 188 : 276,
      viewportWidth: vpWidth,
      tiltX: 2.5,
      tiltY: -3.2,
    });
    assert.equal(activeTx.isActive, true);
    assert.equal(activeTx.visible, true);
    assert.ok(activeTx.translateZ > 0);
    assert.equal(activeTx.scale, 1);

    const sideTx = computeShelfCardTransform(1, {
      cardWidth: vpWidth < 640 ? 188 : 276,
      viewportWidth: vpWidth,
    });
    assert.equal(sideTx.isActive, false);
    assert.ok(sideTx.translateX > 0);
    assert.ok(sideTx.rotateY < 0);
    assert.ok(sideTx.scale < 1);
  }

  const reducedTx = computeShelfCardTransform(0, {
    cardWidth: 276,
    viewportWidth: 1440,
    prefersReducedMotion: true,
    tiltX: 4,
    tiltY: 4,
  });
  assert.equal(reducedTx.rotateX, 0);
  assert.equal(reducedTx.rotateY, 0);

  // 4. Editorial subtitle never exposes promptText
  const subtitle = formatPublicEditorialSubtitle(READY_MADE_PROMPTS[0]);
  assert.equal(subtitle.includes('promptText'), false);

  // 5. Component & CSS verification: zero VHS/Leon Vasari/movie leakage, zero promptText leakage, 9:16 portrait shelf cards, fine-pointer cursor, non-overlapping mobile buttons
  const shelfSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/HeroShelf3D.tsx'), 'utf-8');
  const cursorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/LandingCursor.tsx'), 'utf-8');
  const homeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/HomePage.tsx'), 'utf-8');
  const cssSource = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf-8');

  const combined = `${shelfSource}\n${cursorSource}\n${homeSource}`;
  assert.doesNotMatch(combined, /Leon Vasari|VHS|Filmography|movie|director/i);
  assert.doesNotMatch(combined, /promptText/);
  assert.match(shelfSource, /aspect-\[9\/16\]/);
  assert.match(shelfSource, /object-cover/);
  assert.match(shelfSource, /No Published Artworks Yet/);
  assert.match(shelfSource, /overflow-x-clip/);
  assert.match(shelfSource, /createPortal/);
  assert.match(shelfSource, /OPEN/);
  assert.match(shelfSource, /aria-label="Previous artwork"[\s\S]{0,160}md:hidden/);

  assert.match(cursorSource, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(cursorSource, /requestAnimationFrame/);
  assert.match(cursorSource, /cancelAnimationFrame/);
  assert.match(cursorSource, /OPEN/);
  assert.match(cssSource, /@media \(hover: hover\) and \(pointer: fine\)/);
});

test('25. Cross-browser clipboard fallback, sync-activation unlock prefetch, manual-copy recovery, and extended ad-frame diagnostics hold', async () => {
  const { copyTextWithFallback } = await import('../src/lib/clipboard.ts');

  // 1. Empty text fails safely without throwing
  const emptyResult = await copyTextWithFallback('');
  assert.equal(emptyResult.ok, false);
  assert.equal(emptyResult.reason, 'empty_text');

  // 2. Secure-context Clipboard API success
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;

  try {
    let writtenText = '';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { isSecureContext: true, getSelection: () => null },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (text: string) => {
            writtenText = text;
          },
        },
      },
    });
    const okRes = await copyTextWithFallback('editorial travertine courtyard prompt');
    assert.equal(okRes.ok, true);
    assert.equal(okRes.method, 'clipboard-api');
    assert.equal(writtenText, 'editorial travertine courtyard prompt');

    // 3. When Clipboard API throws NotAllowedError, falls back to execCommand cleanly
    let appendedTag = '';
    let execCommandCalled = false;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error('NotAllowedError');
          },
        },
      },
    });
    const fakeTextarea = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: () => {},
      focus: () => {},
      select: () => {},
      setSelectionRange: () => {},
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        activeElement: null,
        body: {
          appendChild: (el: unknown) => {
            appendedTag = el === fakeTextarea ? 'textarea' : 'other';
          },
          removeChild: () => {},
        },
        createElement: (tag: string) => {
          assert.equal(tag, 'textarea');
          return fakeTextarea;
        },
        execCommand: (cmd: string) => {
          execCommandCalled = cmd === 'copy';
          return true;
        },
      },
    });

    const fallbackRes = await copyTextWithFallback('fallback prompt text');
    assert.equal(fallbackRes.ok, true);
    assert.equal(fallbackRes.method, 'exec-command');
    assert.equal(appendedTag, 'textarea');
    assert.equal(execCommandCalled, true);

    // 4. When both Clipboard API and execCommand are blocked, returns ok: false honestly
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        activeElement: null,
        body: { appendChild: () => {}, removeChild: () => {} },
        createElement: () => fakeTextarea,
        execCommand: () => false,
      },
    });
    const blockedRes = await copyTextWithFallback('blocked prompt text');
    assert.equal(blockedRes.ok, false);
    assert.equal(blockedRes.method, 'none');
    assert.equal(blockedRes.reason, 'clipboard_blocked');
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }

  // 5. AppContext & PromptDetailsPage enforce auth-only prefetch, sync clipboard path, and manual-copy fallback
  const appCtxSource = fs.readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.tsx'), 'utf-8');
  assert.match(appCtxSource, /copyTextWithFallback/);
  assert.match(appCtxSource, /unlockPrompt/);
  assert.match(appCtxSource, /unlockedPromptsRef\.current\[id\]/);
  assert.match(appCtxSource, /clipboardErrorId/);
  assert.match(appCtxSource, /Prompt copied successfully!/);

  const detailsSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PromptDetailsPage.tsx'), 'utf-8');
  assert.match(detailsSource, /unlockPrompt\(id,\s*\{\s*silent:\s*true\s*\}\)/);
  assert.match(detailsSource, /manual-copy-prompt-field/);
  assert.match(detailsSource, /selectElementText/);
  assert.match(detailsSource, /Prompt copied successfully!/);

  // 6. Adsterra diagnostics classify all 5 outcomes, support HTML-parsed about:blank frames, and gate verbose logs in DEV
  const frameSource = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/adFrameHtml.ts'), 'utf-8');
  assert.match(frameSource, /HTMLIFrameElement\.prototype/);
  assert.match(frameSource, /resolveOutcomeCategory/);
  assert.match(frameSource, /earlyScriptStates/);
  assert.match(frameSource, /lookupScriptResponseStatus/);
  for (const cat of ['script_loaded', 'iframe_created', 'creative_rendered', 'no_inventory', 'blocked_rendering']) {
    assert.ok(frameSource.includes(`'${cat}'`), `Missing diagnostic outcomeCategory: ${cat}`);
  }

  const adSlotSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AdSlot.tsx'), 'utf-8');
  assert.match(adSlotSource, /import\.meta\.env\?\.DEV/);
  assert.match(adSlotSource, /data-ad-placement-id/);
  assert.match(adSlotSource, /data-ad-outcome/);
  assert.match(adSlotSource, /data-ad-response-status/);
  assert.match(adSlotSource, /cleanup_unmounted/);

  const injectorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/VisualAdInjector.tsx'), 'utf-8');
  assert.match(injectorSource, /IS_DEV_INJECTOR/);
  assert.match(injectorSource, /placementId=\{placement\.id\}/);
  assert.match(injectorSource, /slotId=\{placement\.slotId\}/);
});




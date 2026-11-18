# ImageLab Firestore Security Specification

## 1. Data Invariants
1. **Default-Deny Baseline**: Every path not explicitly matched is denied (`allow read, write: if false`).
2. **No Self-Assigned Privilege Escalation**: A client creating a `/users/{userId}` document MUST specify `role == "contributor"` and `accountStatus == "active"`. Only the server-side Firebase Admin SDK (never client SDK) may assign `"admin"` or `"super_admin"`.
3. **Immutable Role & Status on Client Updates**: A user updating their own `/users/{userId}` document may ONLY update `fullName`, `username`, `photoURL`, `bio`, and `lastLoginAt`. Any attempt to modify `role`, `uid`, `email`, `createdAt`, or `accountStatus` is rejected.
4. **Strict PII Isolation**: `/users/{userId}` contains `email` and `accountStatus` and can ONLY be read (`get`) by the owning user (`request.auth.uid == userId`) or a verified Admin/Super Admin. Unauthenticated visitors and other contributors cannot read another user's `/users/{userId}` document or list `/users`.
5. **Non-PII Username Uniqueness**: `/usernames/{username}` stores only `{ uid, username, createdAt }` (no email or PII). Individual lookups (`get`) are permitted for registration availability checks; `list` is denied to prevent enumeration.
6. **Super Admin Protection**: Normal Admins cannot modify, demote, or delete any user whose role is `"super_admin"`, nor promote any user to `"super_admin"`. Only server-side Admin SDK calls verified against a `super_admin` token can manage admin roles, and `siteSettings` writes are restricted exclusively to `super_admin`.
7. **Prompt Ownership & Moderation**: Public users can read `"approved"` prompts. Contributors can create prompts with `authorUid == request.auth.uid`, and edit/delete only their own prompts without changing `authorUid` or `status`. Admins and Super Admins can approve, reject, or remove any prompt.
8. **Strict Key Allowlisting & Size Bounds**: Every `create` uses `hasAll` + `hasOnly`, every `update` uses `affectedKeys().hasOnly(...)`, every string has a `.size()` bound, and every timestamp enforces `request.time`.
9. **Ads Manager & Visual Placements Isolation**: `/adPlacements/{placementId}` and `/ads/{adId}` are strictly restricted (`get`, `list`, `create`, `update`, `delete`) to verified active Admins and Super Admins (`isAdmin()`). Disabled or draft ad scripts are never readable publicly. `/publicAdSlots/{adId}` may only be created/updated/deleted by `isAdmin()` with `status == 'active'` for active public slot delivery.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Admin Registration**: `create /users/attacker` with `{ role: "admin" }` -> `PERMISSION_DENIED`.
2. **Self-Super-Admin Registration**: `create /users/attacker` with `{ role: "super_admin" }` -> `PERMISSION_DENIED`.
3. **Role Escalation Update**: `update /users/contributorUid` with `{ role: "super_admin" }` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: `create /users/uid` with extra ghost field `{ isVerifiedAdmin: true }` -> `PERMISSION_DENIED`.
5. **Cross-User PII Read**: Contributor A attempts `get /users/contributorB` -> `PERMISSION_DENIED`.
6. **Users Collection Scraping**: Contributor A attempts `list /users` -> `PERMISSION_DENIED`.
7. **Admin Modifying Super Admin**: Admin attempts `update /users/superAdminUid` -> `PERMISSION_DENIED`.
8. **Admin Promoting to Super Admin**: Admin attempts `update /users/contributorUid` with `{ role: "super_admin" }` -> `PERMISSION_DENIED`.
9. **Unauthenticated Prompt Publish**: Visitor (`auth == null`) attempts `create /prompts/p1` -> `PERMISSION_DENIED`.
10. **Author Spoofing**: Contributor A creates `/prompts/p2` with `{ authorUid: "contributorB" }` -> `PERMISSION_DENIED`.
11. **Contributor Self-Approving Rejected Prompt**: Contributor updates `/prompts/p1` changing `{ status: "approved" }` -> `PERMISSION_DENIED`.
12. **Admin Modifying Site Settings**: Admin (not Super Admin) attempts `write /siteSettings/global` -> `PERMISSION_DENIED`.

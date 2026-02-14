import { describe, it, expect } from 'vitest';
import { Role, Permission, ROLE_PERMISSIONS } from './types';

describe('RBAC Permission Matrix', () => {
  it('owner should have all permissions', () => {
    const allPermissions = Object.values(Permission);
    const ownerPerms = ROLE_PERMISSIONS[Role.OWNER];
    for (const perm of allPermissions) {
      expect(ownerPerms).toContain(perm);
    }
  });

  it('admin should have all permissions', () => {
    const allPermissions = Object.values(Permission);
    const adminPerms = ROLE_PERMISSIONS[Role.ADMIN];
    for (const perm of allPermissions) {
      expect(adminPerms).toContain(perm);
    }
  });

  it('therapist should NOT have user management permissions', () => {
    const therapistPerms = ROLE_PERMISSIONS[Role.THERAPIST];
    expect(therapistPerms).not.toContain(Permission.USER_CREATE);
    expect(therapistPerms).not.toContain(Permission.USER_EDIT);
    expect(therapistPerms).not.toContain(Permission.USER_DEACTIVATE);
  });

  it('therapist should have clinical permissions', () => {
    const therapistPerms = ROLE_PERMISSIONS[Role.THERAPIST];
    expect(therapistPerms).toContain(Permission.NOTE_CREATE);
    expect(therapistPerms).toContain(Permission.NOTE_SIGN);
    expect(therapistPerms).toContain(Permission.PATIENT_CREATE);
    expect(therapistPerms).toContain(Permission.SCHEDULE_CREATE);
  });

  it('front_desk should NOT have billing edit or note creation', () => {
    const fdPerms = ROLE_PERMISSIONS[Role.FRONT_DESK];
    expect(fdPerms).not.toContain(Permission.BILLING_CREATE);
    expect(fdPerms).not.toContain(Permission.NOTE_CREATE);
    expect(fdPerms).not.toContain(Permission.NOTE_SIGN);
  });

  it('front_desk should have scheduling permissions', () => {
    const fdPerms = ROLE_PERMISSIONS[Role.FRONT_DESK];
    expect(fdPerms).toContain(Permission.SCHEDULE_CREATE);
    expect(fdPerms).toContain(Permission.SCHEDULE_EDIT);
    expect(fdPerms).toContain(Permission.PATIENT_CREATE);
  });

  it('biller should have billing and claims but not notes creation', () => {
    const billerPerms = ROLE_PERMISSIONS[Role.BILLER];
    expect(billerPerms).toContain(Permission.BILLING_CREATE);
    expect(billerPerms).toContain(Permission.CLAIM_SUBMIT);
    expect(billerPerms).toContain(Permission.ERA_IMPORT);
    expect(billerPerms).not.toContain(Permission.NOTE_CREATE);
    expect(billerPerms).not.toContain(Permission.SCHEDULE_CREATE);
  });

  it('read_only should only have view permissions', () => {
    const roPerms = ROLE_PERMISSIONS[Role.READ_ONLY];
    for (const perm of roPerms) {
      expect(perm).toMatch(/view$/);
    }
  });

  it('read_only should NOT have any write permissions', () => {
    const roPerms = ROLE_PERMISSIONS[Role.READ_ONLY];
    const writePerms = [
      Permission.PATIENT_CREATE, Permission.PATIENT_EDIT, Permission.NOTE_CREATE,
      Permission.SCHEDULE_CREATE, Permission.BILLING_CREATE, Permission.CLAIM_SUBMIT,
      Permission.ATTACHMENT_UPLOAD, Permission.USER_CREATE,
    ];
    for (const perm of writePerms) {
      expect(roPerms).not.toContain(perm);
    }
  });

  it('all roles should be defined', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });
});

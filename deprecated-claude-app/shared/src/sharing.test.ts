import { describe, it, expect } from 'vitest';
import {
  canChat,
  canDelete,
  canView,
  hasAtLeastPermission,
  type SharePermission,
} from './sharing.js';

// ============================================================================
// canChat
// ============================================================================

describe('canChat', () => {
  it('returns true for collaborator', () => {
    expect(canChat('collaborator')).toBe(true);
  });

  it('returns true for editor', () => {
    expect(canChat('editor')).toBe(true);
  });

  it('returns false for viewer', () => {
    expect(canChat('viewer')).toBe(false);
  });
});

// ============================================================================
// canDelete
// ============================================================================

describe('canDelete', () => {
  it('returns true for editor', () => {
    expect(canDelete('editor')).toBe(true);
  });

  it('returns false for collaborator', () => {
    expect(canDelete('collaborator')).toBe(false);
  });

  it('returns false for viewer', () => {
    expect(canDelete('viewer')).toBe(false);
  });
});

// ============================================================================
// canView
// ============================================================================

describe('canView', () => {
  it('returns true for viewer', () => {
    expect(canView('viewer')).toBe(true);
  });

  it('returns true for collaborator', () => {
    expect(canView('collaborator')).toBe(true);
  });

  it('returns true for editor', () => {
    expect(canView('editor')).toBe(true);
  });
});

// ============================================================================
// hasAtLeastPermission
// ============================================================================

describe('hasAtLeastPermission', () => {
  it('editor has at least viewer permission', () => {
    expect(hasAtLeastPermission('editor', 'viewer')).toBe(true);
  });

  it('editor has at least collaborator permission', () => {
    expect(hasAtLeastPermission('editor', 'collaborator')).toBe(true);
  });

  it('editor has at least editor permission', () => {
    expect(hasAtLeastPermission('editor', 'editor')).toBe(true);
  });

  it('collaborator has at least viewer permission', () => {
    expect(hasAtLeastPermission('collaborator', 'viewer')).toBe(true);
  });

  it('collaborator has at least collaborator permission', () => {
    expect(hasAtLeastPermission('collaborator', 'collaborator')).toBe(true);
  });

  it('collaborator does NOT have editor permission', () => {
    expect(hasAtLeastPermission('collaborator', 'editor')).toBe(false);
  });

  it('viewer does NOT have collaborator permission', () => {
    expect(hasAtLeastPermission('viewer', 'collaborator')).toBe(false);
  });

  it('viewer does NOT have editor permission', () => {
    expect(hasAtLeastPermission('viewer', 'editor')).toBe(false);
  });

  it('viewer has at least viewer permission', () => {
    expect(hasAtLeastPermission('viewer', 'viewer')).toBe(true);
  });
});

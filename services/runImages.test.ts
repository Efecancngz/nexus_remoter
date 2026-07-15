import { describe, it, expect } from 'vitest';
import { idsToDelete } from './runImages';

describe('idsToDelete', () => {
  it('returns all existing ids when keep is empty', () => {
    expect(idsToDelete(['a', 'b'], [])).toEqual(['a', 'b']);
  });
  it('returns only ids not present in keep', () => {
    expect(idsToDelete(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
  it('returns empty when keep is a superset', () => {
    expect(idsToDelete(['a'], ['a', 'b'])).toEqual([]);
  });
  it('returns empty for empty existing', () => {
    expect(idsToDelete([], ['a'])).toEqual([]);
  });
});

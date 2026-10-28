import { describe, expect, test } from 'bun:test';
import { mergeBundleFiles, type FileHashes } from './bundle-merge';

const merge = (base: FileHashes | undefined, local: FileHashes, remote: FileHashes, localNewer = false) =>
  mergeBundleFiles({ base, local, remote, localIsNewer: () => localNewer });

describe('mergeBundleFiles', () => {
  test('a file only fl0w-work changed, added, or deleted takes its version', () => {
    expect(merge({ a: '1', b: '1', c: '1' }, { a: '1', b: '1', c: '1' }, { a: '2', b: '1', d: '1' })).toEqual({
      take: ['a', 'd'],
      remove: ['c'],
      conflicts: [],
    });
  });

  test('a file only this device changed, added, or deleted stays as it is here', () => {
    expect(merge({ a: '1', b: '1', c: '1' }, { a: '2', c: '1', d: '1' }, { a: '1', b: '1', c: '1' })).toEqual({
      take: [],
      remove: [],
      conflicts: [],
    });
  });

  test('changes to different files on each side both survive', () => {
    expect(merge({ a: '1', b: '1' }, { a: '2', b: '1' }, { a: '1', b: '2' })).toEqual({ take: ['b'], remove: [], conflicts: [] });
  });

  test('the same change on both sides is not a conflict', () => {
    expect(merge({ a: '1' }, { a: '2' }, { a: '2' })).toEqual({ take: [], remove: [], conflicts: [] });
  });

  test('a file both sides changed keeps the newer copy', () => {
    expect(merge({ a: '1' }, { a: '2' }, { a: '3' }, true)).toEqual({
      take: [],
      remove: [],
      conflicts: [{ path: 'a', kept: 'local' }],
    });
    expect(merge({ a: '1' }, { a: '2' }, { a: '3' }, false)).toEqual({
      take: ['a'],
      remove: [],
      conflicts: [{ path: 'a', kept: 'remote' }],
    });
  });

  test('an edit beats a deletion on the other side when it is newer, and a local deletion never wins a conflict', () => {
    expect(merge({ a: '1' }, { a: '2' }, {}, true)).toEqual({ take: [], remove: [], conflicts: [{ path: 'a', kept: 'local' }] });
    expect(merge({ a: '1' }, { a: '2' }, {}, false)).toEqual({ take: [], remove: ['a'], conflicts: [{ path: 'a', kept: 'remote' }] });
    expect(merge({ a: '1' }, {}, { a: '2' }, true)).toEqual({ take: ['a'], remove: [], conflicts: [{ path: 'a', kept: 'remote' }] });
  });

  test('without a base, files on one side only are kept and differing files go to the newer side', () => {
    expect(merge(undefined, { a: '1', l: '1' }, { a: '2', r: '1' }, true)).toEqual({
      take: ['r'],
      remove: [],
      conflicts: [{ path: 'a', kept: 'local' }],
    });
  });
});

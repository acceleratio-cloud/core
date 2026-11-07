import { diffBucketConfigs } from '../s3-bucket.diff';

describe('diffBucketConfigs', () => {
  it('reports a different storage profile by name, without impact', () => {
    const names: Record<string, string> = { a: 'Fast', b: 'Archive' };

    expect(
      diffBucketConfigs(
        { storage_class_id: 'a' },
        { storage_class_id: 'b' },
        (id) => names[id],
      ),
    ).toEqual([
      {
        key: 'storage',
        label: 'Storage',
        changes: [
          {
            path: 'storage_class_id',
            label: 'Storage profile',
            kind: 'changed',
            before: 'Fast',
            after: 'Archive',
            secret: false,
            impact: null,
          },
        ],
      },
    ]);
  });

  it('reports nothing for the same profile', () => {
    expect(
      diffBucketConfigs({ storage_class_id: 'a' }, { storage_class_id: 'a' })[0]
        .changes,
    ).toEqual([]);
  });
});

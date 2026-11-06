import { NotFoundException } from '@nestjs/common';
import { NodeService } from '../node.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const node = (unschedulable?: boolean) => ({
  metadata: { name: 'n1', labels: { 'kubernetes.io/hostname': 'n1', a: 'b' } },
  spec: { unschedulable },
  status: {},
});

const build = () => {
  const coreV1 = {
    listNode: jest.fn(),
    readNode: jest.fn().mockResolvedValue(node(true)),
    patchNode: jest.fn().mockResolvedValue({}),
    listPodForAllNamespaces: jest.fn().mockResolvedValue({
      items: [
        { spec: { nodeName: 'n1' }, status: { phase: 'Running' } },
        { spec: { nodeName: 'n1' }, status: { phase: 'Succeeded' } },
      ],
    }),
  };
  const service = new NodeService({ coreV1 } as never);

  return { coreV1, service };
};

describe('NodeService', () => {
  it('cordons by setting spec.unschedulable', async () => {
    const { coreV1, service } = build();
    const result = await service.setSchedulable('n1', false);

    expect(coreV1.patchNode).toHaveBeenCalledWith({
      name: 'n1',
      body: [{ op: 'add', path: '/spec/unschedulable', value: true }],
    });
    expect(result.unschedulable).toBe(true);
    expect(result.pod_count).toBe(1);
  });

  it('keeps cluster-owned labels when replacing labels', async () => {
    const { coreV1, service } = build();

    await service.updateLabels('n1', { labels: { pool: 'gpu' } });

    expect(coreV1.patchNode).toHaveBeenCalledWith({
      name: 'n1',
      body: [
        {
          op: 'add',
          path: '/metadata/labels',
          value: { pool: 'gpu', 'kubernetes.io/hostname': 'n1' },
        },
      ],
    });
  });

  it('maps a missing node to 404', async () => {
    const { coreV1, service } = build();

    coreV1.readNode.mockRejectedValue({ code: 404 });

    await expect(service.get('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

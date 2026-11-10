export const formatCpu = (cpu: number) => `${cpu} vCPU`;

export const formatMemory = (mib: number) =>
  mib >= 1024 ? `${mib / 1024} GiB` : `${mib} MiB`;

export const formatServices = (count: number) =>
  count === 1 ? '1 service' : `${count} services`;

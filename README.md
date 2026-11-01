# Acceleratio

Open-source, self-hosted cloud platform. Your cloud, your data, your control.

## Install on a VPS

The installer provisions a single-node Kubernetes cluster with k3s, embedded
etcd, Cilium, SeaweedFS and a default SeaweedFS StorageClass. The application
itself is not installed by this version.

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/install.sh | sudo bash
```

To remove the cluster, Cilium and SeaweedFS data later:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/uninstall.sh | sudo bash -s -- --yes
```

Requirements, configuration, verification and uninstall details live in
[deploy/README.md](./deploy/README.md).

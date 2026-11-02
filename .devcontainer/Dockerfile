# syntax=docker/dockerfile:1

# Development image for the API and console. It pins the same runtimes as the
# production Dockerfiles and adds the local tooling used by scripts/dev.sh and
# scripts/cluster.sh. Docker itself comes from the docker-in-docker feature in
# devcontainer.json.

FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

# Keep Bun 1.4.0 pinned; it matches the production images.
COPY --from=oven/bun:1.4.0-debian /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx

# Keep the Kubernetes tools aligned with scripts/cluster.sh and
# deploy/install.sh. The architecture is resolved at build time so the same
# file works on amd64 and arm64 hosts.
ARG K3D_VERSION=v5.9.0
ARG HELM_VERSION=v3.18.0
ARG KUBECTL_VERSION=v1.36.5

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL -o /usr/local/bin/k3d "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${arch}"; \
    chmod 0755 /usr/local/bin/k3d; \
    curl -fsSL -o /tmp/helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-${arch}.tar.gz"; \
    tar -xzf /tmp/helm.tar.gz -C /tmp "linux-${arch}/helm"; \
    install -m 0755 "/tmp/linux-${arch}/helm" /usr/local/bin/helm; \
    rm -rf /tmp/helm.tar.gz "/tmp/linux-${arch}"; \
    curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl"; \
    chmod 0755 /usr/local/bin/kubectl; \
    bun --version; \
    k3d version; \
    helm version; \
    kubectl version --client

# Docker 29 defaults to the containerd overlayfs snapshotter. Nested overlay
# mounts are not available in every Docker Desktop setup, so use the portable
# vfs driver for the Docker-in-Docker daemon. Slower than overlayfs, but it
# works on macOS, Linux, and Codespaces without host-specific configuration.
RUN mkdir -p /etc/docker && \
    printf '%s\n' '{"storage-driver":"vfs","features":{"containerd-snapshotter":false}}' > /etc/docker/daemon.json

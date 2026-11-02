import { Global, Module } from '@nestjs/common';
import { KubernetesService } from './kubernetes.service';
import { KubernetesWatchService } from './kubernetes-watch.service';

@Global()
@Module({
  providers: [KubernetesService, KubernetesWatchService],
  exports: [KubernetesService, KubernetesWatchService],
})
export class KubernetesModule {}

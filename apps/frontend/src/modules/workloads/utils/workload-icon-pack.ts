import type { ComponentType, SVGProps } from 'react';
import Angular from '@thesvg/react/angular';
import Astro from '@thesvg/react/astro';
import Bun from '@thesvg/react/bun';
import Csharp from '@thesvg/react/csharp';
import Deno from '@thesvg/react/deno';
import Django from '@thesvg/react/django';
import Docker from '@thesvg/react/docker';
import Dotnet from '@thesvg/react/dotnet';
import Elixir from '@thesvg/react/elixir';
import Fastapi from '@thesvg/react/fastapi';
import Flask from '@thesvg/react/flask';
import Go from '@thesvg/react/go';
import Java from '@thesvg/react/java';
import Javascript from '@thesvg/react/javascript';
import Kotlin from '@thesvg/react/kotlin';
import Laravel from '@thesvg/react/laravel';
import Mongodb from '@thesvg/react/mongodb';
import Mysql from '@thesvg/react/mysql';
import Nestjs from '@thesvg/react/nestjs';
import Nextjs from '@thesvg/react/nextjs';
import Nginx from '@thesvg/react/nginx';
import Nodejs from '@thesvg/react/nodejs';
import Nuxt from '@thesvg/react/nuxt';
import Php from '@thesvg/react/php';
import Postgresql from '@thesvg/react/postgresql';
import Python from '@thesvg/react/python';
import ReactLogo from '@thesvg/react/react';
import Redis from '@thesvg/react/redis';
import Ruby from '@thesvg/react/ruby';
import Rust from '@thesvg/react/rust';
import Spring from '@thesvg/react/spring';
import Svelte from '@thesvg/react/svelte';
import Swift from '@thesvg/react/swift';
import Typescript from '@thesvg/react/typescript';
import Vue from '@thesvg/react/vue';

import type { WorkloadIconId } from '@acceleratio/shared';

type PackSvg = ComponentType<SVGProps<SVGSVGElement>>;

export interface WorkloadPackIcon {
  id: WorkloadIconId;
  label: string;
  Svg: PackSvg;
  /**
   * Black or white marks render their `mono` variant, which follows the text
   * colour on the dark console. Only set it on icons that have one.
   */
  mono?: boolean;
}

/**
 * Built-in icons. Keyed by every `WORKLOAD_ICON_IDS` id, so an id the API
 * accepts without a logo here fails the build.
 */
const PACK: Record<WorkloadIconId, Omit<WorkloadPackIcon, 'id'>> = {
  python: { label: 'Python', Svg: Python },
  javascript: { label: 'JavaScript', Svg: Javascript },
  typescript: { label: 'TypeScript', Svg: Typescript },
  nodejs: { label: 'Node.js', Svg: Nodejs },
  deno: { label: 'Deno', Svg: Deno, mono: true },
  bun: { label: 'Bun', Svg: Bun },
  react: { label: 'React', Svg: ReactLogo },
  nextjs: { label: 'Next.js', Svg: Nextjs },
  vue: { label: 'Vue', Svg: Vue },
  nuxt: { label: 'Nuxt', Svg: Nuxt },
  angular: { label: 'Angular', Svg: Angular },
  svelte: { label: 'Svelte', Svg: Svelte },
  astro: { label: 'Astro', Svg: Astro, mono: true },
  go: { label: 'Go', Svg: Go },
  rust: { label: 'Rust', Svg: Rust, mono: true },
  java: { label: 'Java', Svg: Java },
  spring: { label: 'Spring', Svg: Spring },
  kotlin: { label: 'Kotlin', Svg: Kotlin },
  csharp: { label: 'C#', Svg: Csharp },
  dotnet: { label: '.NET', Svg: Dotnet },
  php: { label: 'PHP', Svg: Php },
  laravel: { label: 'Laravel', Svg: Laravel },
  ruby: { label: 'Ruby', Svg: Ruby },
  django: { label: 'Django', Svg: Django, mono: true },
  flask: { label: 'Flask', Svg: Flask, mono: true },
  fastapi: { label: 'FastAPI', Svg: Fastapi },
  nestjs: { label: 'NestJS', Svg: Nestjs },
  elixir: { label: 'Elixir', Svg: Elixir },
  swift: { label: 'Swift', Svg: Swift },
  docker: { label: 'Docker', Svg: Docker },
  postgresql: { label: 'PostgreSQL', Svg: Postgresql },
  mysql: { label: 'MySQL', Svg: Mysql },
  mongodb: { label: 'MongoDB', Svg: Mongodb },
  redis: { label: 'Redis', Svg: Redis },
  nginx: { label: 'NGINX', Svg: Nginx },
};

export const WORKLOAD_ICON_PACK: WorkloadPackIcon[] = Object.entries(PACK).map(
  ([id, icon]) => ({ id: id as WorkloadIconId, ...icon }),
);

const byId = new Map<string, WorkloadPackIcon>(
  WORKLOAD_ICON_PACK.map((icon) => [icon.id, icon]),
);

export const packIcon = (id: string | null | undefined) =>
  id ? byId.get(id) : undefined;

/** What the API accepts as a remote icon; mirrors `normalizeWorkloadIcon`. */
export const isIconUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Mermaid } from '@/components/mermaid';
import { ImageZoom, type ImageZoomProps } from 'fumadocs-ui/components/image-zoom';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Mermaid,
    // Screenshots open full size on click.
    img: (props) => <ImageZoom {...(props as ImageZoomProps)} />,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

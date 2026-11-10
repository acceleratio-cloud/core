'use client';

import type { ComponentProps } from 'react';
import { Dices } from 'lucide-react';
import { generate } from 'random-words';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

/** Two random words joined by a hyphen, such as `brave-river`. */
export const generateName = (): string => (generate(2) as string[]).join('-');

/**
 * A name input with a button that puts a newly generated name in it. The
 * field stays a plain input: any name can still be typed.
 */
export const GeneratedNameInput = ({
  onGenerate,
  ...props
}: ComponentProps<typeof Input> & { onGenerate: (name: string) => void }) => (
  <div className="flex items-center gap-2">
    <Input autoComplete="off" spellCheck={false} {...props} />
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Generate another name"
      title="Generate another name"
      disabled={props.disabled}
      onClick={() => onGenerate(generateName())}
    >
      <Dices aria-hidden="true" strokeWidth={1.75} className="size-4" />
    </Button>
  </div>
);

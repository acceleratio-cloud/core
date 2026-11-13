'use client';

import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { gitConfig, siteUrl } from '@/lib/shared';

type Rating = 'helpful' | 'not helpful';

/**
 * "Was this page helpful?" for a static site: the answer opens a prefilled
 * GitHub issue, so it needs no backend and nothing is sent without the reader.
 */
export const Feedback = ({ title, url }: { title: string; url: string }) => {
  const [rating, setRating] = useState<Rating | null>(null);
  const [message, setMessage] = useState('');

  const issueUrl = () => {
    const params = new URLSearchParams({
      title: `Docs feedback: ${title} (${rating})`,
      body: [`Page: ${siteUrl}${url}`, `Rating: ${rating}`, '', message.trim() || '_No comment._'].join('\n'),
      labels: 'documentation',
    });
    return `https://github.com/${gitConfig.user}/${gitConfig.repo}/issues/new?${params}`;
  };

  return (
    <section aria-labelledby="feedback-title" className="mt-12 rounded-xl border bg-fd-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="feedback-title" className="m-0 font-sans text-sm font-medium tracking-normal">
          Was this page helpful?
        </h2>
        <div className="flex gap-2" role="group" aria-label="Rate this page">
          {(
            [
              ['helpful', 'Yes', ThumbsUp],
              ['not helpful', 'No', ThumbsDown],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'gap-1.5 rounded-full',
                rating === value && 'border-fd-primary text-fd-primary',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {rating ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            window.open(issueUrl(), '_blank', 'noopener,noreferrer');
          }}
        >
          <label htmlFor="feedback-message" className="text-sm text-fd-muted-foreground">
            {rating === 'helpful' ? 'Anything we should keep or add? (optional)' : 'What was missing or wrong? (optional)'}
          </label>
          <textarea
            id="feedback-message"
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="rounded-lg border bg-fd-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
          />
          <div className="flex items-center gap-3">
            <button type="submit" className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'rounded-full')}>
              Send on GitHub
            </button>
            <span className="text-xs text-fd-muted-foreground">Opens a new GitHub issue for you to submit.</span>
          </div>
        </form>
      ) : null}
    </section>
  );
};

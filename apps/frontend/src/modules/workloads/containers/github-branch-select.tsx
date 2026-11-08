'use client';

import { useEffect, useState } from 'react';

import { githubApi } from '@/api/github';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

/**
 * The branches of a repository the App can reach. The current value stays
 * listed even when GitHub no longer has it, so the field never goes blank.
 */
export const GithubBranchSelect = ({
  id,
  appId,
  repository,
  value,
  onChange,
  disabled,
}: {
  id: string;
  appId: string;
  repository: string;
  value: string;
  onChange: (branch: string) => void;
  disabled?: boolean;
}) => {
  const key = `${appId}/${repository}`;
  const [loaded, setLoaded] = useState<{ key: string; list: string[] } | null>(
    null,
  );
  const branches = loaded?.key === key ? loaded.list : null;

  useEffect(() => {
    let cancelled = false;

    githubApi
      .branches(appId, repository)
      .then((list) => !cancelled && setLoaded({ key, list }))
      // The current branch stays choosable; saving reports what went wrong.
      .catch(() => !cancelled && setLoaded({ key, list: [] }));

    return () => {
      cancelled = true;
    };
  }, [appId, repository, key]);

  const items = [
    ...(value && !branches?.includes(value) ? [value] : []),
    ...(branches ?? []),
  ];

  return (
    <Select
      value={value || null}
      items={items.map((item) => ({ value: item, label: item }))}
      disabled={disabled || branches === null}
      onValueChange={(next) => typeof next === 'string' && onChange(next)}
    >
      <SelectTrigger id={id} className="font-mono">
        <SelectValue
          placeholder={
            branches === null ? 'Loading branches…' : 'Choose a branch'
          }
        />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item} value={item} className="font-mono">
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

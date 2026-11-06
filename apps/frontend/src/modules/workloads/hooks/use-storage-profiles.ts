'use client';

import { useEffect, useState } from 'react';

import type { StorageClass } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { storageClassesApi } from '@/api/storage-classes';

export type StorageProfilesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profiles: StorageClass[] };

/** Storage profiles, platform first, as the settings page lists them. */
export const useStorageProfiles = () => {
  const [state, setState] = useState<StorageProfilesState>({
    status: 'loading',
  });

  useEffect(() => {
    let active = true;

    storageClassesApi
      .list()
      .then((profiles) => {
        if (active) {
          setState({ status: 'ready', profiles });
        }
      })
      .catch((error) => {
        if (active) {
          setState({ status: 'error', message: getApiErrorMessage(error) });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
};

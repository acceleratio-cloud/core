import "server-only";

import { cookies } from "next/headers";
import axios from "axios";
import type { Project } from "@acceleratio/shared";

import { api } from "@/api";

export const getServerProject = async (id: string): Promise<Project | null> => {
  try {
    const cookieStore = await cookies();
    const { data } = await api.get<Project>(
      `/projects/${encodeURIComponent(id)}`,
      { headers: { cookie: cookieStore.toString() } },
    );

    return data;
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;

    if (status === 400 || status === 404) {
      return null;
    }

    throw error;
  }
};

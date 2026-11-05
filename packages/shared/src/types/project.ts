export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectPayload {
  name: string;
}

export interface UpdateProjectPayload {
  name?: string;
}

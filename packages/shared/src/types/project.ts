export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectPayload {
  name: string;
}

export interface UpdateProjectPayload {
  name?: string;
}

import type {
  CreatedInvite,
  CreateInvitePayload,
  CustomRole,
  CustomRolePayload,
  Invite,
  Member,
  UpdateMemberPayload,
} from '@acceleratio/shared';

import { api } from '@/api';

const memberPath = (userId: string) =>
  `/members/${encodeURIComponent(userId)}`;

export const membersApi = {
  list: async () => {
    const { data } = await api.get<Member[]>('/members');
    return data;
  },
  update: async (userId: string, payload: UpdateMemberPayload) => {
    const { data } = await api.patch<Member>(memberPath(userId), payload);
    return data;
  },
  remove: async (userId: string) => {
    await api.delete(memberPath(userId));
  },
  transferOwnership: async (userId: string) => {
    await api.post(`${memberPath(userId)}/transfer-ownership`);
  },
  listRoles: async () => {
    const { data } = await api.get<CustomRole[]>('/roles');
    return data;
  },
  createRole: async (payload: CustomRolePayload) => {
    const { data } = await api.post<CustomRole>('/roles', payload);
    return data;
  },
  updateRole: async (id: string, payload: CustomRolePayload) => {
    const { data } = await api.patch<CustomRole>(`/roles/${id}`, payload);
    return data;
  },
  removeRole: async (id: string) => {
    await api.delete(`/roles/${id}`);
  },
  listInvites: async () => {
    const { data } = await api.get<Invite[]>('/invites');
    return data;
  },
  createInvite: async (payload: CreateInvitePayload) => {
    const { data } = await api.post<CreatedInvite>('/invites', payload);
    return data;
  },
  revokeInvite: async (id: string) => {
    await api.delete(`/invites/${id}`);
  },
};

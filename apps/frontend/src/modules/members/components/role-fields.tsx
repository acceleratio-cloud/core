'use client';

import type { CustomRole } from '@acceleratio/shared';

import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type GrantableRole } from '../roles';

export type RoleChoice = { role: GrantableRole; roleId: string | null };

/** A built-in role, or `custom` plus which custom role. */
export const RoleFields = ({
  id,
  value,
  onChange,
  roles,
  customRoles,
}: {
  id: string;
  value: RoleChoice;
  onChange: (value: RoleChoice) => void;
  roles: GrantableRole[];
  customRoles: CustomRole[];
}) => {
  const roleItems = roles.map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
  }));
  const customItems = customRoles.map((role) => ({
    value: role.id,
    label: role.name,
  }));

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
        <Select
          value={value.role}
          items={roleItems}
          onValueChange={(next) => {
            if (typeof next === 'string') {
              onChange({
                role: next as GrantableRole,
                roleId:
                  next === 'custom' ? (value.roleId ?? customRoles[0]?.id ?? null) : null,
              });
            }
          }}
        >
          <SelectTrigger id={`${id}-role`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{ROLE_DESCRIPTIONS[value.role]}</FieldDescription>
      </Field>

      {value.role === 'custom' ? (
        <Field>
          <FieldLabel htmlFor={`${id}-custom`}>Custom role</FieldLabel>
          {customItems.length === 0 ? (
            <FieldDescription>
              Create a custom role first, under Roles on this page.
            </FieldDescription>
          ) : (
            <Select
              value={value.roleId}
              items={customItems}
              onValueChange={(next) => {
                if (typeof next === 'string') {
                  onChange({ role: 'custom', roleId: next });
                }
              }}
            >
              <SelectTrigger id={`${id}-custom`} className="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {customItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}
    </>
  );
};

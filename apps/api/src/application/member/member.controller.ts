import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  CreateInvitePayload,
  CreatedInvite,
  CustomRole,
  CustomRolePayload,
  Invite,
  Member,
  UpdateMemberPayload,
} from '@acceleratio/shared';
import { CurrentAccess, RequireAccess, type Access } from './access';
import { MemberService } from './member.service';

/**
 * Users, custom roles and invite links. Reads are open to every built-in
 * role, changes to the owner and admins (AccessGuard); who may touch which
 * role is decided in MemberService.
 */
@Controller()
export class MemberController {
  constructor(private readonly members: MemberService) {}

  @Get('members')
  list(): Promise<Member[]> {
    return this.members.list();
  }

  @Patch('members/:userId')
  update(
    @CurrentAccess() access: Access,
    @Param('userId') userId: string,
    @Body() body: UpdateMemberPayload,
  ): Promise<Member> {
    return this.members.update(access, userId, body);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentAccess() access: Access,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.members.remove(access, userId);
  }

  @Post('members/:userId/transfer-ownership')
  @RequireAccess('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  transferOwnership(
    @CurrentAccess() access: Access,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.members.transferOwnership(access, userId);
  }

  @Get('roles')
  listRoles(): Promise<CustomRole[]> {
    return this.members.listRoles();
  }

  @Post('roles')
  createRole(@Body() body: CustomRolePayload): Promise<CustomRole> {
    return this.members.createRole(body);
  }

  @Patch('roles/:id')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CustomRolePayload,
  ): Promise<CustomRole> {
    return this.members.updateRole(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRole(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.members.removeRole(id);
  }

  @Get('invites')
  listInvites(): Promise<Invite[]> {
    return this.members.listInvites();
  }

  @Post('invites')
  createInvite(
    @CurrentAccess() access: Access,
    @Body() body: CreateInvitePayload,
  ): Promise<CreatedInvite> {
    return this.members.createInvite(access, body);
  }

  @Delete('invites/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvite(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.members.revokeInvite(access, id);
  }
}
